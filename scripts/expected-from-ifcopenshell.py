#!/usr/bin/env python3
"""Ground truth for the IFC conformance fixtures, generated independently of web-ifc.

IfcOpenShell is the reference implementation buildingSMART's own validation service uses,
so it is the arbiter: `tests/unit/index-builder.fixture.test.ts` runs SGVue's index builder
over the same file and must agree with what this writes. A divergence is a defect to fix or
to document — never to hide (SYSTEM_SPEC §5).

Usage:
    python3 scripts/expected-from-ifcopenshell.py "samples/Sample Ifc Model.ifc"
    python3 scripts/expected-from-ifcopenshell.py            # every .ifc in samples/

Writes tests/fixtures/<file-stem>.expected.json. Requires the system python3 to have
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


def sample_element(model, ifc_class: str, length_to_m: float, georef: dict) -> dict | None:
    """The first element of a class by expressId — deterministic across runs."""
    candidates = [e for e in model.by_type(ifc_class) if e.is_a() == ifc_class]
    if not candidates:
        return None
    element = min(candidates, key=lambda e: e.id())
    storey = ifcopenshell.util.element.get_container(element, ifc_class="IfcBuildingStorey")
    type_object = ifcopenshell.util.element.get_type(element)
    site = georef.get("site") or {}
    geometry = world_geometry(
        element, site.get("placement"), site.get("rotationDeg") or 0.0
    ) or {}
    return {
        "expressId": element.id(),
        "guid": element.GlobalId,
        "type": element.is_a(),
        "name": element.Name or "",
        "tag": getattr(element, "Tag", None) or "",
        "predefinedType": getattr(element, "PredefinedType", None) or "",
        "objectType": (type_object.Name if type_object else None)
        or getattr(element, "ObjectType", None)
        or "",
        "typeGuid": type_object.GlobalId if type_object else "",
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
    }


def main(argv: list[str]) -> int:
    targets = [Path(a) for a in argv[1:]] or sorted(SAMPLES.glob("*.ifc"))
    if not targets:
        print("no .ifc files in samples/ — nothing to do", file=sys.stderr)
        return 0
    FIXTURES.mkdir(parents=True, exist_ok=True)
    for path in targets:
        if not path.is_absolute():
            path = ROOT / path
        print(f"reading {path.name} …", flush=True)
        expected = build(path)
        out = FIXTURES / f"{path.stem}.expected.json"
        out.write_text(json.dumps(expected, indent=2, sort_keys=True) + "\n")
        print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1024:.0f} kB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
