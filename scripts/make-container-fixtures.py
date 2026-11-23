#!/usr/bin/env python3
"""Dev utility — write the Spatial-structure card's fixtures (2026-11-23):
`tests/fixtures/containers/full-ifc4.ifc` and `sparse-ifc2x3.ifc`,
`tests/unit/containers.fixture.test.ts`'s.

The card compares every attribute and property set of `IfcProject`, the spatial-root `IfcSite`
and its `IfcBuilding` across the loaded models. These two files are the two ends of that:

 · `full-ifc4.ifc` — IFC4, millimetres, every one of those attributes authored: Name, LongName,
   Description, ObjectType, Phase on the project; CompositionType, RefLatitude / RefLongitude
   (with millionths), RefElevation (4 700, not the placement's 5 050), LandTitleNumber and an `IfcPostalAddress` with every part on
   the site; ElevationOfRefHeight, ElevationOfTerrain and a three-part address on the building;
   and property sets on all three, of the value kinds a set carries (text, identifier, integer,
   real, boolean, area). The site placement carries the repository's synthetic map position
   and rotation, as `georef/a-site-placement.ifc`'s does.
 · `sparse-ifc2x3.ifc` — IFC2X3, metres, most of it absent: a project with a Name only, a site
   with a Name, its mandatory CompositionType and a southern / western reference point, a
   building with no Name, an ElevationOfRefHeight of zero (authored, so not absent) and an
   ElevationOfTerrain of 2.5 m, one
   property set on the site and none on the project or the building.

The ground truth is not written here: `scripts/expected-from-ifcopenshell.py --containers` reads
these files back with IfcOpenShell into `tests/fixtures/containers/ifcopenshell.json`, raw
attributes only.

Synthetic: no real name, address or coordinate — the map position is the repository's synthetic
set (site 12345.457 / 23456.766 / 5.05 m, rotation −43.4103°), every string made up.
Deterministic: GlobalIds from a counter, a fixed header timestamp, no owner history. The scaffold
is `make-tiny-ifc.py`'s own `Fixture`.

    python3 scripts/make-container-fixtures.py
"""
from __future__ import annotations

import hashlib
import importlib.util
import pathlib
import sys

try:
    import ifcopenshell  # noqa: F401
except ImportError:  # pragma: no cover - dev utility
    sys.exit("IfcOpenShell is not installed:  pip3 install ifcopenshell")

HERE = pathlib.Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("make_tiny_ifc", HERE / "make-tiny-ifc.py")
tiny = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tiny)  # type: ignore[union-attr]

OUT = tiny.FIXTURES / "containers"


def pset(fx, target, name: str, props: list[tuple[str, str, object]]) -> None:
    """One `IfcPropertySet` of single values — (name, IFC value type, value) — on `target`."""
    f = fx.f
    single = [
        f.create_entity("IfcPropertySingleValue", Name=n, NominalValue=f.create_entity(t, v))
        for n, t, v in props
    ]
    s = f.create_entity("IfcPropertySet", GlobalId=tiny.gid(), Name=name, HasProperties=single)
    f.create_entity(
        "IfcRelDefinesByProperties", GlobalId=tiny.gid(), RelatedObjects=[target], RelatingPropertyDefinition=s
    )


def slab(fx, place, size: float):
    """One slab on the storey, so the file draws something."""
    return fx.element("IfcSlab", "Slab", place, (0.0, 0.0, 0.0), (size, size, size / 30.0), PredefinedType="FLOOR")


def full() -> pathlib.Path:
    fx = tiny.Fixture(
        "full-ifc4.ifc",
        "Synthetic Project",
        out_dir=OUT,
        schema="IFC4",
        millimetres=True,
        site_at=(tiny.SITE_E * 1000, tiny.SITE_N * 1000, tiny.SITE_H * 1000),
        site_deg=tiny.SITE_DEG,
    )
    f = fx.f
    f.header.file_name.preprocessor_version = "scripts/make-container-fixtures.py"

    project = fx.project
    project.LongName = "Synthetic Project — Long Name"
    project.Description = "A synthetic project description"
    project.ObjectType = "SYNTHETIC_PROJECT_TYPE"
    project.Phase = "Construction Documents"

    site = fx.f.by_type("IfcSite")[0]
    site.Name = "Site Plot A"
    site.LongName = "Plot A"
    site.Description = "A synthetic site description"
    site.ObjectType = "SYNTHETIC_SITE_TYPE"
    site.RefLatitude = (12, 34, 56, 789000)
    site.RefLongitude = (98, 7, 6, 543210)
    # Not the placement's 5 050: the card's RefElevation is this attribute, never the base point's Z.
    site.RefElevation = 4700.0
    site.LandTitleNumber = "LOT-0001-A"
    site.SiteAddress = f.create_entity(
        "IfcPostalAddress",
        Purpose="SITE",
        Description="Main gate",
        UserDefinedPurpose="Deliveries",
        InternalLocation="Gate 2",
        AddressLines=["1 Example Avenue", "Block C"],
        PostalBox="PO 12",
        Town="Example Town",
        Region="Example Region",
        PostalCode="000001",
        Country="Example Country",
    )

    building = fx.building
    building.Name = "Tower C"
    building.LongName = "Tower C — Residential"
    building.Description = "A synthetic building description"
    building.ObjectType = "SYNTHETIC_BUILDING_TYPE"
    building.ElevationOfRefHeight = 5050.0
    building.ElevationOfTerrain = 4800.0
    building.BuildingAddress = f.create_entity(
        "IfcPostalAddress",
        AddressLines=["1 Example Avenue"],
        PostalCode="000001",
        Country="Example Country",
    )

    storeys = []
    for name, elevation in (("Level 1", 0.0), ("Level 2", 4000.0)):
        storey, place = fx.storey(name, elevation)
        storeys.append(storey)
        fx.contain(storey, [slab(fx, place, 6000.0)])
    fx.aggregate(building, storeys)

    pset(fx, project, "Project_Information", [
        ("ProjectNumber", "IfcIdentifier", "P-0001"),
        ("ClientName", "IfcLabel", "Sample Client"),
        ("IsSample", "IfcBoolean", True),
        ("Budget", "IfcReal", 1250000.5),
    ])
    pset(fx, site, "Pset_SiteCommon", [
        ("TotalArea", "IfcAreaMeasure", 8420.0),
        ("BuildableArea", "IfcAreaMeasure", 6100.0),
    ])
    pset(fx, site, "SGPset_Site", [
        ("CXBlockID", "IfcLabel", "1"),
        ("NumberOfWorkers", "IfcInteger", 120),
    ])
    pset(fx, building, "Pset_BuildingCommon", [
        ("NumberOfStoreys", "IfcInteger", 2),
        ("YearOfConstruction", "IfcLabel", "2027"),
    ])
    pset(fx, building, "SGPset_Building", [
        ("OwnerBuiltOwnerStay", "IfcBoolean", False),
    ])
    fx.write(len(storeys))
    return fx.out


def sparse() -> pathlib.Path:
    fx = tiny.Fixture("sparse-ifc2x3.ifc", "Synthetic Project", out_dir=OUT, schema="IFC2X3")
    f = fx.f
    f.header.file_name.preprocessor_version = "scripts/make-container-fixtures.py"

    site = f.by_type("IfcSite")[0]
    site.Name = "Default Site"
    # South and west: every component negative, as IFC writes it.
    site.RefLatitude = (-12, -34, -56)
    site.RefLongitude = (-98, -7, -6)

    building = fx.building
    building.Name = None
    building.ElevationOfRefHeight = 0.0
    # A non-zero length in a metre file, so the unit conversion is pinned for metres too.
    building.ElevationOfTerrain = 2.5

    storey, place = fx.storey("Level 1", 0.0)
    fx.contain(storey, [slab(fx, place, 6.0)])
    fx.aggregate(building, [storey])

    pset(fx, site, "Pset_SiteCommon", [("TotalArea", "IfcAreaMeasure", 8420.0)])
    fx.write(1)
    return fx.out


def main() -> None:
    for path in (full(), sparse()):
        print(f"  sha256 {hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}")


if __name__ == "__main__":
    main()
