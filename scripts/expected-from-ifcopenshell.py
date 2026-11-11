#!/usr/bin/env python3
"""Ground truth for the IFC conformance fixtures, generated independently of web-ifc.

IfcOpenShell is the reference implementation buildingSMART's own validation service uses,
so it is the arbiter: `tests/unit/index-builder.fixture.test.ts` runs SGVue's index builder
over the same file and must agree with what this writes. A divergence is a defect to fix or
to document — never to hide (SYSTEM_SPEC §5).

Usage:
    python3 scripts/expected-from-ifcopenshell.py "samples/Sample Ifc Model.ifc"
    python3 scripts/expected-from-ifcopenshell.py            # every .ifc in samples/
    python3 scripts/expected-from-ifcopenshell.py --cells-only tests/fixtures/feet.ifc
    python3 scripts/expected-from-ifcopenshell.py --identities  # tests/fixtures/identities.json

Writes tests/fixtures/<file-stem>.expected.json — since 2026-11-07 with `identities`, every
indexed element's raw identity by GlobalId (since 2026-11-11 one key per attribute, the
occurrence's own ObjectType and the type's Name apart: `identity()`), which the test compares
element by element (a file written before 2026-11-11 fails and asks to be regenerated) — and,
since 2026-11-08, tests/fixtures/<file-stem>.cells.json: every indexed element's property and
quantity values with their measure types, the fields a schedule shows, and the file's unit
scales, which `tests/unit/schedule/oracle.test.ts` checks every schedule cell against.
`--cells-only` writes just the cells file. `--identities` writes tests/fixtures/identities.json,
the same identities for every committed fixture model that has no expected.json of its own.
Requires the system python3 to have
IfcOpenShell installed (0.8.4 was used to write this). This is a development script and
lives outside src/ on purpose: only settings.ts and sessions.ts may write to disk inside
the app.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sys
from pathlib import Path

import ifcopenshell
import ifcopenshell.geom
import ifcopenshell.ifcopenshell_wrapper
import ifcopenshell.util.classification
import ifcopenshell.util.element
import ifcopenshell.util.placement
import ifcopenshell.util.unit

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = ROOT / "samples"
FIXTURES = ROOT / "tests" / "fixtures"

SI_PREFIX = {
    "EXA": 1e18, "PETA": 1e15, "TERA": 1e12, "GIGA": 1e9, "MEGA": 1e6, "KILO": 1e3,
    "HECTO": 1e2, "DECA": 1e1, "DECI": 1e-1, "CENTI": 1e-2, "MILLI": 1e-3,
    "MICRO": 1e-6, "NANO": 1e-9, "PICO": 1e-12, "FEMTO": 1e-15, "ATTO": 1e-18,
}


def plain(value):
    """Make an IFC attribute JSON-safe, keeping it exactly as authored."""
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, (tuple, list)):
        return [plain(v) for v in value]
    if isinstance(value, ifcopenshell.entity_instance):
        return f"#{value.id()}={value.is_a()}"
    return str(value)


def unit_factor(unit) -> float | None:
    """SI units per file unit: MILLI/METRE -> 0.001, DEGREE -> 0.017453..."""
    if unit.is_a("IfcSIUnit"):
        prefix = SI_PREFIX.get(unit.Prefix or "", 1.0)
        name = unit.Name or ""
        power = 2 if name.startswith("SQUARE_") else 3 if name.startswith("CUBIC_") else 1
        return prefix ** power
    if unit.is_a("IfcConversionBasedUnit"):
        conversion = unit.ConversionFactor
        base = conversion.UnitComponent
        base_prefix = SI_PREFIX.get(getattr(base, "Prefix", None) or "", 1.0)
        return float(conversion.ValueComponent.wrappedValue) * base_prefix
    return None


def read_units(model) -> dict:
    out = {}
    for project in model.by_type("IfcProject"):
        assignment = project.UnitsInContext
        if not assignment:
            continue
        for unit in assignment.Units or []:
            unit_type = getattr(unit, "UnitType", None)
            if not unit_type:
                continue
            out[unit_type] = {
                "entity": unit.is_a(),
                "name": getattr(unit, "Name", None) or "",
                "prefix": getattr(unit, "Prefix", None) or "",
                "factor": unit_factor(unit),
            }
        break
    return out


def strip_ids(sets: dict) -> dict:
    """get_psets() adds an `id` key per set; it is provenance, not an authored property."""
    return {
        name: {k: plain(v) for k, v in values.items() if k != "id"}
        for name, values in sets.items()
    }


def material_name(element) -> str:
    material = ifcopenshell.util.element.get_material(element, should_skip_usage=True)
    if material is None:
        return ""
    if material.is_a("IfcMaterial"):
        return material.Name or ""
    if material.is_a("IfcMaterialLayerSet"):
        name = material.LayerSetName or ""
        if name:
            return name
        names = [layer.Material.Name for layer in material.MaterialLayers if layer.Material]
        return " + ".join(dict.fromkeys(n for n in names if n))
    if material.is_a("IfcMaterialList"):
        names = [m.Name for m in material.Materials if m]
        return " + ".join(dict.fromkeys(n for n in names if n))
    for attribute in ("Name", "LayerSetName"):
        value = getattr(material, attribute, None)
        if value:
            return value
    parts = (
        list(getattr(material, "MaterialProfiles", None) or [])
        + list(getattr(material, "MaterialConstituents", None) or [])
    )
    names = [p.Material.Name for p in parts if getattr(p, "Material", None)]
    return " + ".join(dict.fromkeys(n for n in names if n))


def classifications(element) -> list:
    out = []
    for reference in sorted(
        ifcopenshell.util.classification.get_references(element), key=lambda r: r.id()
    ):
        source = reference.ReferencedSource
        out.append(
            {
                "system": (getattr(source, "Name", None) or "") if source else "",
                "identification": getattr(reference, "Identification", None)
                or getattr(reference, "ItemReference", None)
                or "",
                "name": reference.Name or "",
                "location": reference.Location or "",
            }
        )
    return out


def world_geometry(element, site_placement, site_rotation_deg: float) -> dict | None:
    """One element's tessellation in the file's own WORLD coordinates, metres.

    This is the independent answer the app's project frame is checked against: the app streams
    geometry through the inverse of the spatial-root site placement, so putting its readout
    back through the base point has to land on these numbers.

    Returns the axis-aligned world box, one exact world vertex, and the box of the same
    vertices in the PROJECT frame — which is what the app's element box and the property card's
    Length and Width report. The project box is built from the vertices, never from the world
    box's corners: rotating an axis-aligned box inflates it (a 87 x 83 m wall becomes 120 x 120).
    """
    try:
        settings = ifcopenshell.geom.settings()
        settings.set("use-world-coords", True)
        shape = ifcopenshell.geom.create_shape(settings, element)
    except Exception:
        return None
    verts = list(shape.geometry.verts)
    if len(verts) < 3:
        return None
    points = [verts[i:i + 3] for i in range(0, len(verts) - 2, 3)]
    box = [min(p[k] for p in points) for k in range(3)] + [
        max(p[k] for p in points) for k in range(3)
    ]

    ox, oy, oz = site_placement or (0.0, 0.0, 0.0)
    a = math.radians(-site_rotation_deg)
    cos, sin = math.cos(a), math.sin(a)
    local = [
        (
            (p[0] - ox) * cos - (p[1] - oy) * sin,
            (p[0] - ox) * sin + (p[1] - oy) * cos,
            p[2] - oz,
        )
        for p in points
    ]
    project = [min(p[k] for p in local) for k in range(3)] + [
        max(p[k] for p in local) for k in range(3)
    ]
    return {
        "worldBox": box,
        "worldVertex": points[0],
        "projectBox": project,
        "vertexCount": len(points),
    }


def predefined_code(element) -> str:
    """`IfcElement.predefinedType`, the code as written (2026-11-07): the occurrence's own
    `PredefinedType` when it states one other than NOTDEFINED (USERDEFINED stays USERDEFINED),
    else the type object's when it states one other than NOTDEFINED, else the NOTDEFINED either
    wrote, else "". Never ObjectType, ElementType or Name text."""
    type_object = ifcopenshell.util.element.get_type(element)
    occurrence = getattr(element, "PredefinedType", None) or ""
    of_type = (getattr(type_object, "PredefinedType", None) or "") if type_object else ""
    stated = lambda v: v not in ("", "NOTDEFINED")  # noqa: E731
    return occurrence if stated(occurrence) else of_type if stated(of_type) else occurrence or of_type


def indexed_elements(model) -> list:
    """Every element the app indexes — IfcElement less openings, then IfcSpace — the one list
    `build()`, `cells()` and `--identities` read."""
    openings = {e.id() for e in model.by_type("IfcOpeningElement")}
    out = [e for e in model.by_type("IfcElement") if e.id() not in openings]
    return out + list(model.by_type("IfcSpace"))


def identity(element) -> dict:
    """The identity fields the index builder must agree on for *every* element: IfcOpenShell's
    **raw readings only**, one key per attribute (2026-11-07; widened 2026-11-11).

    The lesson of 2026-11-11: this script records what IfcOpenShell reads. A rule of the app — a
    fallback, a join, "the type's Name, else the occurrence's ObjectType" — is stated in the test
    that compares, by name, and is never baked in here. `objectType` once was the type's Name
    before the occurrence's ObjectType, which is the app's own rule, so the truth agreed with the
    bug it was meant to catch. `predefinedType` is the one computed value, and the test says so.
    """
    type_object = ifcopenshell.util.element.get_type(element)
    return {
        "expressId": element.id(),
        "guid": element.GlobalId,
        "type": element.is_a(),
        "name": element.Name or "",
        "longName": getattr(element, "LongName", None) or "",
        "description": element.Description or "",
        "tag": getattr(element, "Tag", None) or "",
        # The occurrence's own `ObjectType` attribute, as written — never the type's Name.
        "objectType": getattr(element, "ObjectType", None) or "",
        # `get_type(element).Name` — the type object `IfcRelDefinesByType` assigns.
        "typeName": (type_object.Name or "") if type_object else "",
        "typeGuid": type_object.GlobalId if type_object else "",
        # The code as written: the app's documented reading of the raw attributes (2026-11-07).
        "predefinedType": predefined_code(element),
        # IfcOpenShell's own reading — `IfcElement.effectivePredefinedType`.
        "effectivePredefinedType": ifcopenshell.util.element.get_predefined_type(element) or "",
    }


# ── every element's schedule cells (2026-11-08) ──────────────────────────────────────────────
#
# `tests/unit/schedule/oracle.test.ts` checks every cell of the Schedules window against what
# IfcOpenShell reads. The values come from `get_psets` (the type's sets first, the occurrence's
# over them key by key); the measure type of each value is read off the property / quantity
# line itself, in the same order, so a value and its measure cannot come from different lines.

# The unit types whose scale IfcOpenShell's `calculate_unit_scale` resolves from the file's own
# unit assignment. Every other measure (a count, a ratio, a derived unit) is reported as written.
SCALED_UNIT_TYPES = ("LENGTHUNIT", "AREAUNIT", "VOLUMEUNIT", "PLANEANGLEUNIT", "MASSUNIT")


def _schema_attribute_type(model, entity, index: int) -> str | None:
    """The declared IFC type of an entity's attribute — `IfcLengthMeasure` for a length."""
    schema = ifcopenshell.ifcopenshell_wrapper.schema_by_name(model.schema)
    declared = schema.declaration_by_name(entity.is_a()).attribute_by_index(index).type_of_attribute()
    named = getattr(declared, "declared_type", None)
    return named().name() if named else None


def _line_info(model, line) -> dict:
    """What a property or quantity line says about its value: the measure type, and — for any
    property that is not a single value — its class (`p`), since `get_psets` reads an enumerated
    value and a list value alike."""
    if line.is_a("IfcPhysicalSimpleQuantity"):
        return {"m": _schema_attribute_type(model, line, 3)}
    if line.is_a("IfcPropertySingleValue"):
        value = line.NominalValue
        return {"m": value.is_a() if value is not None else None}
    items = getattr(line, "EnumerationValues", None) or getattr(line, "ListValues", None) or []
    return {"m": items[0].is_a() if items else None, "p": line.is_a()}


def _set_lines(model, definition) -> dict:
    """prop / quantity name → `_line_info`, for one IfcPropertySet or IfcElementQuantity."""
    if definition.is_a("IfcPropertySet"):
        return {prop.Name: _line_info(model, prop) for prop in definition.HasProperties or []}
    if definition.is_a("IfcElementQuantity"):
        return {q.Name: _line_info(model, q) for q in definition.Quantities or []}
    return {}


def _definitions(element) -> list:
    """The type's property definitions, then the occurrence's — `get_psets`' own precedence."""
    out = []
    type_object = ifcopenshell.util.element.get_type(element)
    if type_object is not None:
        out += list(getattr(type_object, "HasPropertySets", None) or [])
    for rel in getattr(element, "IsDefinedBy", None) or []:
        if rel.is_a("IfcRelDefinesByProperties"):
            relating = rel.RelatingPropertyDefinition
            out += list(relating) if isinstance(relating, tuple) else [relating]
    return out


def _without_ids(sets: dict) -> dict:
    """`strip_ids` without making the values plain: `_cell` still needs a bounded value's lines."""
    return {name: {k: v for k, v in values.items() if k != "id"} for name, values in sets.items()}


BOUNDS = ("LowerBoundValue", "UpperBoundValue", "SetPointValue")


def _cell(value, info: dict) -> dict:
    """One value as `get_psets` read it. A bounded value comes back as its line's attributes;
    it is written as {"v": {bound: value}, "m": {bound: measure}} with the absent bounds left out."""
    if isinstance(value, dict) and value.get("type") == "IfcPropertyBoundedValue":
        present = {b: value[b] for b in BOUNDS if value.get(b) is not None}
        return {
            "v": {b: v.wrappedValue for b, v in present.items()},
            "m": {b: v.is_a() for b, v in present.items()},
            "p": "IfcPropertyBoundedValue",
        }
    return {"v": plain(value), **info}


def _measured(model, element, values: dict) -> dict:
    """{set: {prop: {"v": value as written, "m": measure type or null, "p"?: property class}}}."""
    lines: dict = {}
    for definition in _definitions(element):
        if definition is not None and getattr(definition, "Name", None):
            lines.setdefault(definition.Name, {}).update(_set_lines(model, definition))
    return {
        name: {prop: _cell(value, lines.get(name, {}).get(prop, {"m": None})) for prop, value in props.items()}
        for name, props in values.items()
    }


def _parent(product):
    """The spatial element above a product: its container, else what aggregates it."""
    return ifcopenshell.util.element.get_container(product) or ifcopenshell.util.element.get_aggregate(
        product
    )


def _above(product, ifc_class: str):
    node, depth = _parent(product), 0
    while node is not None and depth < 64:
        if node.is_a(ifc_class):
            return node
        node, depth = _parent(node), depth + 1
    return None


def _names(product) -> dict:
    return {"name": product.Name or "", "longName": getattr(product, "LongName", None) or ""}


def _material_names(element) -> list:
    """Every individual material IfcOpenShell finds for the element, in the file's order."""
    material = ifcopenshell.util.element.get_material(element, should_skip_usage=True)
    if material is None:
        return []
    if material.is_a("IfcMaterial"):
        return [material.Name or ""]
    if material.is_a("IfcMaterialLayerSet"):
        return [layer.Material.Name or "" for layer in material.MaterialLayers if layer.Material]
    if material.is_a("IfcMaterialList"):
        return [m.Name or "" for m in material.Materials if m]
    parts = list(getattr(material, "MaterialProfiles", None) or []) + list(
        getattr(material, "MaterialConstituents", None) or []
    )
    return [p.Material.Name or "" for p in parts if getattr(p, "Material", None)]


def _unit_scale(unit) -> float:
    """SI per one of a named unit — `calculate_unit_scale`'s own walk, for one unit line."""
    scale = 1.0
    while unit.is_a("IfcConversionBasedUnit"):
        scale *= unit.ConversionFactor.ValueComponent.wrappedValue
        unit = unit.ConversionFactor.UnitComponent
    if unit.is_a("IfcSIUnit"):
        scale *= ifcopenshell.util.unit.get_prefix_multiplier(unit.Prefix)
    return scale


def _derived_scales(model) -> dict:
    """UnitType → SI per one of each `IfcDerivedUnit` the project assigns: the product of its
    elements' scales, each raised to its exponent. `calculate_unit_scale` takes named units only."""
    out: dict = {}
    for project in model.by_type("IfcProject"):
        for unit in (project.UnitsInContext.Units if project.UnitsInContext else None) or []:
            if unit.is_a("IfcDerivedUnit") and unit.UnitType != "USERDEFINED":
                scale = 1.0
                for element in unit.Elements:
                    scale *= _unit_scale(element.Unit) ** element.Exponent
                out[unit.UnitType] = scale
        break
    return out


def _measures_of(cell: dict) -> list:
    m = cell.get("m")
    return list(m.values()) if isinstance(m, dict) else [m] if m else []


def cells(path: Path) -> dict:
    """What a schedule shows for every indexed element, as IfcOpenShell reads it."""
    model = ifcopenshell.open(str(path))
    indexed = indexed_elements(model)

    scales = {u: ifcopenshell.util.unit.calculate_unit_scale(model, u) for u in SCALED_UNIT_TYPES}
    measure_types: dict = {}
    storeys: dict = {}
    spatial: dict = {}
    elements: dict = {}

    def ref(product):
        if product is None:
            return None
        spatial.setdefault(product.GlobalId, _names(product))
        return product.GlobalId

    for element in indexed:
        storey = _above(element, "IfcBuildingStorey")
        if storey is not None and storey.GlobalId not in storeys:
            storeys[storey.GlobalId] = {
                **_names(storey),
                "elevation": storey.Elevation * scales["LENGTHUNIT"] if storey.Elevation is not None else None,
            }
        type_object = ifcopenshell.util.element.get_type(element)
        psets = _measured(model, element, _without_ids(ifcopenshell.util.element.get_psets(element, psets_only=True)))
        qtos = _measured(model, element, _without_ids(ifcopenshell.util.element.get_psets(element, qtos_only=True)))
        for sets in (psets, qtos):
            for props in sets.values():
                for cell in props.values():
                    for m in _measures_of(cell):
                        if m not in measure_types:
                            measure_types[m] = ifcopenshell.util.unit.get_measure_unit_type(m)
        elements[element.GlobalId] = {
            "entity": element.is_a(),
            "name": element.Name or "",
            "description": element.Description or "",
            "tag": getattr(element, "Tag", None) or "",
            "objectType": getattr(element, "ObjectType", None) or "",
            "typeName": (type_object.Name or "") if type_object else "",
            "predefinedType": predefined_code(element),
            "longName": getattr(element, "LongName", None) or "",
            "storey": storey.GlobalId if storey is not None else None,
            # The spatial elements above the element itself, by GlobalId into `spatial`.
            "building": ref(_above(element, "IfcBuilding")),
            "site": ref(_above(element, "IfcSite")),
            "space": None if element.is_a("IfcSpace") else ref(_above(element, "IfcSpace")),
            "materials": _material_names(element),
            "psets": psets,
            "qtos": qtos,
        }

    return {
        "generatedBy": f"IfcOpenShell {ifcopenshell.version}",
        "file": path.name,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "unitScales": scales,
        "derivedScales": _derived_scales(model),
        "measureUnitTypes": measure_types,
        "storeys": storeys,
        "spatial": spatial,
        "elements": elements,
    }


def sample_element(model, ifc_class: str, length_to_m: float, georef: dict) -> dict | None:
    """The first element of a class by expressId — deterministic across runs."""
    candidates = [e for e in model.by_type(ifc_class) if e.is_a() == ifc_class]
    if not candidates:
        return None
    element = min(candidates, key=lambda e: e.id())
    storey = ifcopenshell.util.element.get_container(element, ifc_class="IfcBuildingStorey")
    site = georef.get("site") or {}
    geometry = world_geometry(
        element, site.get("placement"), site.get("rotationDeg") or 0.0
    ) or {}
    return {
        **identity(element),
        "storey": (storey.Name or storey.LongName or "") if storey else "",
        "material": material_name(element),
        "classifications": classifications(element),
        "psets": strip_ids(ifcopenshell.util.element.get_psets(element, psets_only=True)),
        "qtos": strip_ids(ifcopenshell.util.element.get_psets(element, qtos_only=True)),
        **geometry,
    }


def dms_to_decimal(dms) -> float:
    values = list(dms) + [0, 0, 0, 0]
    degrees, minutes, seconds, micro = values[0], values[1], values[2], values[3]
    magnitude = abs(degrees) + abs(minutes) / 60 + abs(seconds) / 3600 + abs(micro) / 3.6e9
    return -magnitude if any(v < 0 for v in dms) else magnitude


def spatial_root_site(model):
    """The IfcSite the IfcProject aggregates — never the first by expressId.

    A Revit export can carry a dozen more (the reference model has 16, the extras being
    road-marking families exported as sites) and only this one's placement is the model's
    position. Falls back to the first site for a file whose project aggregates nothing.
    """
    projects = model.by_type("IfcProject")
    if projects:
        for rel in model.by_type("IfcRelAggregates"):
            if rel.RelatingObject == projects[0]:
                for child in rel.RelatedObjects:
                    if child.is_a("IfcSite"):
                        return child
    sites = model.by_type("IfcSite")
    return sites[0] if sites else None


def placement_of(product, length_to_m: float):
    """(location metres, rotation about +Z in degrees) of a product's ObjectPlacement."""
    if product is None or product.ObjectPlacement is None:
        return None, 0.0
    m = ifcopenshell.util.placement.get_local_placement(product.ObjectPlacement)
    location = [float(m[i][3]) * length_to_m for i in range(3)]
    rotation = math.degrees(math.atan2(float(m[1][0]), float(m[0][0])))
    return location, rotation


def true_north(model):
    """The Model context's TrueNorth, normalised, or None."""
    for ctx in model.by_type("IfcGeometricRepresentationContext"):
        if ctx.is_a() != "IfcGeometricRepresentationContext":
            continue
        if (ctx.ContextType or "").lower() != "model" or ctx.TrueNorth is None:
            continue
        ratios = list(ctx.TrueNorth.DirectionRatios)[:2]
        if len(ratios) < 2:
            continue
        length = math.hypot(ratios[0], ratios[1])
        if not length:
            continue
        return [ratios[0] / length, ratios[1] / length]
    return None


def georeference(model, length_to_m: float) -> dict:
    out: dict = {"sources": []}

    conversions = model.by_type("IfcMapConversion") if model.schema != "IFC2X3" else []
    if conversions:
        conversion = conversions[0]
        out["sources"].append("IfcMapConversion")
        out["source"] = "IfcMapConversion"
        out["eastings"] = conversion.Eastings
        out["northings"] = conversion.Northings
        out["orthogonalHeight"] = conversion.OrthogonalHeight
        out["xAxisAbscissa"] = conversion.XAxisAbscissa
        out["xAxisOrdinate"] = conversion.XAxisOrdinate
        out["scale"] = conversion.Scale
        crs = conversion.TargetCRS
        if crs is not None:
            out["crs"] = {
                "name": crs.Name or "",
                "description": crs.Description or "",
                "geodeticDatum": crs.GeodeticDatum or "",
                "verticalDatum": crs.VerticalDatum or "",
                "mapProjection": getattr(crs, "MapProjection", None) or "",
                "mapZone": getattr(crs, "MapZone", None) or "",
            }
    else:
        # IFC2X3 puts the same values in an ePset on IfcSite, spelled either way.
        for site in model.by_type("IfcSite"):
            psets = ifcopenshell.util.element.get_psets(site, psets_only=True)
            for name, values in psets.items():
                if re.fullmatch(r"epset_mapconversion", name, re.IGNORECASE):
                    out["sources"].append("ePset")
                    out["source"] = "ePset"
                    out["epsetName"] = name
                    for key in ("Eastings", "Northings", "OrthogonalHeight",
                                "XAxisAbscissa", "XAxisOrdinate", "Scale"):
                        if key in values:
                            out[key[0].lower() + key[1:]] = values[key]
                    break

    site = spatial_root_site(model)
    if site is not None:
        site_out: dict = {"expressId": site.id()}
        if site.RefLatitude:
            site_out["latitude"] = dms_to_decimal(site.RefLatitude)
        if site.RefLongitude:
            site_out["longitude"] = dms_to_decimal(site.RefLongitude)
        if site.RefElevation is not None:
            site_out["elevation"] = site.RefElevation * length_to_m
        placement, rotation = placement_of(site, length_to_m)
        if placement is not None and any(abs(v) > 0 for v in placement):
            site_out["placement"] = placement
        # A shared-coordinates export carries the rotation to true north here as well as the
        # position, and losing it is what left the whole model standing at 43° to its grid.
        if abs(rotation) >= 1e-9:
            site_out["rotationDeg"] = rotation
        if [k for k in site_out if k != "expressId"]:
            out["sources"].append("IfcSite")
            out.setdefault("source", "IfcSite")
            out["site"] = site_out

    tn = true_north(model)
    if tn is not None:
        out["trueNorth"] = tn

    out.setdefault("source", "none")
    return out


def view_definition(model) -> str:
    for description in model.header.file_description.description or []:
        match = re.search(r"ViewDefinition\s*\[(.*?)\]", description)
        if match:
            return match.group(1).strip()
    return ""


def build(path: Path) -> dict:
    model = ifcopenshell.open(str(path))
    header = model.header
    units = read_units(model)
    length_to_m = (units.get("LENGTHUNIT") or {}).get("factor") or 1.0

    openings = {e.id() for e in model.by_type("IfcOpeningElement")}
    counts: dict[str, int] = {}
    for element in model.by_type("IfcElement"):
        if element.id() in openings:
            continue
        counts[element.is_a()] = counts.get(element.is_a(), 0) + 1

    storeys = sorted(
        (
            {
                "expressId": s.id(),
                "guid": s.GlobalId,
                "name": s.Name or s.LongName or "",
                "elevation": (s.Elevation or 0.0) * length_to_m,
                # Where the storey's floor actually is, in world metres: Elevation is stated
                # relative to whatever the storey is placed in, so on a shared-coordinates
                # export the two differ by the site's own elevation.
                "placement": placement_of(s, length_to_m)[0],
                # IfcSpatialStructureElement.CompositionType — optional, so "" when unset.
                "compositionType": s.CompositionType or "",
            }
            for s in model.by_type("IfcBuildingStorey")
        ),
        key=lambda s: s["elevation"],
    )

    # The two CompositionType rows the Spatial-structure card shows, from the first of each.
    composition = {
        key: (elements[0].CompositionType or "") if elements else ""
        for key, elements in (
            ("IfcSite", model.by_type("IfcSite")),
            ("IfcBuilding", model.by_type("IfcBuilding")),
        )
    }

    sha256 = hashlib.sha256(path.read_bytes()).hexdigest()

    geo = georeference(model, length_to_m)
    samples = {}
    for ifc_class in ("IfcWall", "IfcDoor", "IfcSlab"):
        sample = sample_element(model, ifc_class, length_to_m, geo)
        if sample is not None:
            samples[ifc_class] = sample

    # Every element the app indexes — IfcElement less openings, and IfcSpace — by GlobalId.
    identities = {e.GlobalId: identity(e) for e in indexed_elements(model)}

    return {
        "generatedBy": f"IfcOpenShell {ifcopenshell.version}",
        "file": path.name,
        "sha256": sha256,
        "schema": model.schema,
        "header": {
            "description": list(header.file_description.description or []),
            "viewDefinition": view_definition(model),
            "implementationLevel": header.file_description.implementation_level or "",
            "name": header.file_name.name or "",
            "timeStamp": header.file_name.time_stamp or "",
            "author": list(header.file_name.author or []),
            "organization": list(header.file_name.organization or []),
            "preprocessorVersion": header.file_name.preprocessor_version or "",
            "originatingSystem": header.file_name.originating_system or "",
            "authorization": header.file_name.authorization or "",
            "fileSchema": list(header.file_schema.schema_identifiers or []),
        },
        "units": units,
        "counts": {
            "elements": sum(counts.values()),
            "openings": len(openings),
            "spaces": len(model.by_type("IfcSpace")),
            "propertySets": len(model.by_type("IfcPropertySet")),
            "quantitySets": len(model.by_type("IfcElementQuantity")),
            "byType": dict(sorted(counts.items())),
        },
        "storeys": storeys,
        "composition": composition,
        "georeference": geo,
        "samples": samples,
        "identities": identities,
    }


IDENTITIES = FIXTURES / "identities.json"


def identities_of_fixtures() -> dict:
    """`--identities`: every committed fixture model's raw identities, in one file.

    For every `.ifc` under `tests/fixtures/`, recursively, that has no `<stem>.expected.json` of
    its own beside it (that file carries its identities already), keyed by its path relative to
    `tests/fixtures`: its SHA-256, its schema and every indexed element's `identity` by expressId
    — not by GlobalId, which a file may repeat. `tests/unit/index-builder.fixture.test.ts` holds
    the index to it and fails a fixture with no truth by name, and a stale one by its hash.
    """
    out = {}
    for path in sorted(FIXTURES.rglob("*.ifc")):
        if (path.parent / f"{path.stem}.expected.json").exists():
            continue
        model = ifcopenshell.open(str(path))
        out[path.relative_to(FIXTURES).as_posix()] = {
            "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
            "schema": model.schema,
            "elements": {str(e.id()): identity(e) for e in indexed_elements(model)},
        }
    return {"generatedBy": f"IfcOpenShell {ifcopenshell.version}", "files": out}


def main(argv: list[str]) -> int:
    args = argv[1:]
    if "--identities" in args:
        data = identities_of_fixtures()
        IDENTITIES.write_text(
            json.dumps(data, indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        n = sum(len(f["elements"]) for f in data["files"].values())
        print(f"wrote {IDENTITIES.relative_to(ROOT)} — {len(data['files'])} files, {n} elements")
        return 0
    cells_only = "--cells-only" in args
    targets = [Path(a) for a in args if a != "--cells-only"] or sorted(SAMPLES.glob("*.ifc"))
    if not targets:
        print("no .ifc files in samples/ — nothing to do", file=sys.stderr)
        return 0
    FIXTURES.mkdir(parents=True, exist_ok=True)
    for path in targets:
        if not path.is_absolute():
            path = ROOT / path
        print(f"reading {path.name} …", flush=True)
        outputs = [] if cells_only else [(f"{path.stem}.expected.json", build(path), 2)]
        # Every element of the model: indented by one space a level, which keeps it diffable at about half the size.
        outputs.append((f"{path.stem}.cells.json", cells(path), 1))
        for name, data, indent in outputs:
            out = FIXTURES / name
            out.write_text(json.dumps(data, indent=indent, sort_keys=True) + "\n")
            print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1024:.0f} kB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
