/**
 * Three Schedules cells that disagreed with IfcOpenShell on `edge.ifc`, fixed for 1.5.0
 * (2026-11-08) — each pinned here at its cause, beside the oracle that found it
 * (`oracle.test.ts`):
 *
 *  1. a measure in an `IfcDerivedUnit` the file assigns reaches the schedule in SI — the index
 *     resolves the unit's factor (`derivedFactor`), the adapter converts with it, and the main
 *     window's value stays as authored;
 *  2. Building and Site come from the element's own spatial container, so a wall contained in
 *     the building itself (no storey) still has both;
 *  3. Room / Space comes from that container too, so furniture contained in an `IfcSpace`
 *     names the room — and its storey is still the storey above the room.
 *
 * And one found while fixing the first: a measure's kind is read from its exact type, so a
 * mass per length is not scaled as a length nor a rotational mass as a mass.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { federate } from '../../../src/shared/federate'
import type { ModelIndex } from '../../../src/shared/model-index.types'
import { createReadOnlyIfcSource } from '../../../src/worker/ifc-source'
import { buildModelIndex } from '../../../src/worker/index-builder'
import { snapshotOf } from '../../../src/schedule/adapter'
import { measureKind, measureUnitType } from '../../../src/schedule/ifc/units'

const ROOT = resolve(__dirname, '../../..')

async function indexOfBytes(bytes: Uint8Array, modelKey: string): Promise<ModelIndex> {
  const src = await createReadOnlyIfcSource()
  const modelID = src.openFromBuffer(bytes)
  const index = buildModelIndex(src, modelID, { modelKey, fileName: `${modelKey}.ifc`, sha256: '' })
  src.close(modelID)
  src.dispose()
  return index
}

const edge = indexOfBytes(new Uint8Array(readFileSync(resolve(ROOT, 'tests/fixtures/edge.ifc'))), 'edge')

const byGuid = async (guid: string) => {
  const index = await edge
  const el = index.elements.find((e) => e.guid === guid)
  if (!el) throw new Error(`no ${guid}`)
  return el
}
const coreOf = async (guid: string) => {
  const snap = snapshotOf(federate([await edge]))
  const i = snap.cores.findIndex((c) => c.guid === guid)
  if (i < 0) throw new Error(`no row for ${guid}`)
  return { core: snap.cores[i], cells: snap.cells[i] }
}

describe('a derived unit reaches the schedule in SI', () => {
  it('reads the IFC measure type the way IfcOpenShell does', () => {
    expect(measureUnitType('IfcThermalTransmittanceMeasure')).toBe('THERMALTRANSMITTANCEUNIT')
    expect(measureUnitType('IFCTHERMALTRANSMITTANCEMEASURE')).toBe('THERMALTRANSMITTANCEUNIT')
    expect(measureUnitType('IfcPositiveLengthMeasure')).toBe('LENGTHUNIT')
    expect(measureUnitType('IfcNonNegativeLengthMeasure')).toBe('LENGTHUNIT')
    expect(measureUnitType('IfcMassDensityMeasure')).toBe('MASSDENSITYUNIT')
    expect(measureUnitType('IfcNumericMeasure')).toBe('USERDEFINED')
  })

  it('resolves W/(ft²·K) to 1 / 0.3048² W/(m²·K) in the index', async () => {
    const u = (await edge).units.byType.THERMALTRANSMITTANCEUNIT
    expect(u.entity).toBe('IfcDerivedUnit')
    expect(u.factor).toBeCloseTo(1 / 0.3048 ** 2, 12)
  })

  it('converts the U-value in the schedule, with no unit kind, and leaves the main window’s as authored', async () => {
    for (const guid of ['000000000000000000000E', '000000000000000000000F']) {
      const { cells } = await coreOf(guid)
      const cell = cells['SGVue_Edge.UValue']
      expect(cell.k).toBeUndefined()
      expect(cell.v as number).toBeCloseTo(0.5 / 0.3048 ** 2, 12)
      // The property card reads the index: the value the file wrote.
      expect((await byGuid(guid)).psets.SGVue_Edge.UValue).toBe(0.5)
    }
  })

  it('counts a mass element in kilograms, and leaves an unassigned derived measure as written', async () => {
    // kg/m³, lb/ft³ and g/mm³ assigned; no thermal-transmittance unit, so a U-value stays.
    const step = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION((''),'2;1');
FILE_NAME('derived.ifc','2026-11-08T00:00:00',(''),(''),'','','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
#1=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);
#2=IFCSIUNIT(*,.MASSUNIT.,.KILO.,.GRAM.);
#3=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);
#4=IFCDERIVEDUNITELEMENT(#2,1);
#5=IFCDERIVEDUNITELEMENT(#3,-3);
#6=IFCDERIVEDUNIT((#4,#5),.MASSDENSITYUNIT.,$);
#7=IFCDIMENSIONALEXPONENTS(0,1,0,0,0,0,0);
#8=IFCMEASUREWITHUNIT(IFCMASSMEASURE(0.45359237),#2);
#9=IFCCONVERSIONBASEDUNIT(#7,.MASSUNIT.,'POUND',#8);
#10=IFCDIMENSIONALEXPONENTS(1,0,0,0,0,0,0);
#11=IFCMEASUREWITHUNIT(IFCLENGTHMEASURE(0.3048),#3);
#12=IFCCONVERSIONBASEDUNIT(#10,.LENGTHUNIT.,'FOOT',#11);
#13=IFCDERIVEDUNITELEMENT(#9,1);
#14=IFCDERIVEDUNITELEMENT(#12,-3);
#15=IFCDERIVEDUNIT((#13,#14),.MASSPERLENGTHUNIT.,$);
#16=IFCSIUNIT(*,.MASSUNIT.,$,.GRAM.);
#17=IFCDERIVEDUNITELEMENT(#16,1);
#18=IFCDERIVEDUNITELEMENT(#1,-3);
#19=IFCDERIVEDUNIT((#17,#18),.IONCONCENTRATIONUNIT.,$);
#20=IFCUNITASSIGNMENT((#1,#2,#6,#15,#19));
#21=IFCPROJECT('0000000000000000000001',$,'Derived',$,$,$,$,$,#20);
ENDSEC;
END-ISO-10303-21;
`
    const units = (await indexOfBytes(new TextEncoder().encode(step), 'derived')).units.byType
    // kg/m³ is 1 SI — IfcOpenShell, against the gram, would say 1 000.
    expect(units.MASSDENSITYUNIT.factor).toBeCloseTo(1, 12)
    // (unit types reused only to carry three units at once)
    expect(units.MASSPERLENGTHUNIT.factor).toBeCloseTo(0.45359237 / 0.3048 ** 3, 9)
    expect(units.IONCONCENTRATIONUNIT.factor).toBeCloseTo(1e-3 / 1e-9, 3)
    expect(units.THERMALTRANSMITTANCEUNIT).toBeUndefined()
  })
})

/**
 * Every measure type of IFC2X3, IFC4 and IFC4X3_ADD2 → its unit type, as IfcOpenShell
 * 0.8.4's `get_measure_unit_type` gives it (written out once from IfcOpenShell, 2026-11-08).
 */
const IFCOPENSHELL_UNIT_TYPE: Record<string, string> = {
  IfcAbsorbedDoseMeasure: 'ABSORBEDDOSEUNIT', IfcAccelerationMeasure: 'ACCELERATIONUNIT',
  IfcAmountOfSubstanceMeasure: 'AMOUNTOFSUBSTANCEUNIT',
  IfcAngularVelocityMeasure: 'ANGULARVELOCITYUNIT', IfcAreaDensityMeasure: 'AREADENSITYUNIT',
  IfcAreaMeasure: 'AREAUNIT', IfcCompoundPlaneAngleMeasure: 'COMPOUNDPLANEANGLEUNIT',
  IfcContextDependentMeasure: 'CONTEXTDEPENDENTUNIT', IfcCountMeasure: 'COUNTUNIT',
  IfcCurvatureMeasure: 'CURVATUREUNIT', IfcDescriptiveMeasure: 'DESCRIPTIVEUNIT',
  IfcDoseEquivalentMeasure: 'DOSEEQUIVALENTUNIT',
  IfcDynamicViscosityMeasure: 'DYNAMICVISCOSITYUNIT',
  IfcElectricCapacitanceMeasure: 'ELECTRICCAPACITANCEUNIT',
  IfcElectricChargeMeasure: 'ELECTRICCHARGEUNIT',
  IfcElectricConductanceMeasure: 'ELECTRICCONDUCTANCEUNIT',
  IfcElectricCurrentMeasure: 'ELECTRICCURRENTUNIT',
  IfcElectricResistanceMeasure: 'ELECTRICRESISTANCEUNIT',
  IfcElectricVoltageMeasure: 'ELECTRICVOLTAGEUNIT', IfcEnergyMeasure: 'ENERGYUNIT',
  IfcForceMeasure: 'FORCEUNIT', IfcFrequencyMeasure: 'FREQUENCYUNIT',
  IfcHeatFluxDensityMeasure: 'HEATFLUXDENSITYUNIT', IfcHeatingValueMeasure: 'HEATINGVALUEUNIT',
  IfcIlluminanceMeasure: 'ILLUMINANCEUNIT', IfcInductanceMeasure: 'INDUCTANCEUNIT',
  IfcIntegerCountRateMeasure: 'INTEGERCOUNTRATEUNIT',
  IfcIonConcentrationMeasure: 'IONCONCENTRATIONUNIT',
  IfcIsothermalMoistureCapacityMeasure: 'ISOTHERMALMOISTURECAPACITYUNIT',
  IfcKinematicViscosityMeasure: 'KINEMATICVISCOSITYUNIT', IfcLengthMeasure: 'LENGTHUNIT',
  IfcLinearForceMeasure: 'LINEARFORCEUNIT', IfcLinearMomentMeasure: 'LINEARMOMENTUNIT',
  IfcLinearStiffnessMeasure: 'LINEARSTIFFNESSUNIT', IfcLinearVelocityMeasure: 'LINEARVELOCITYUNIT',
  IfcLuminousFluxMeasure: 'LUMINOUSFLUXUNIT',
  IfcLuminousIntensityDistributionMeasure: 'LUMINOUSINTENSITYDISTRIBUTIONUNIT',
  IfcLuminousIntensityMeasure: 'LUMINOUSINTENSITYUNIT',
  IfcMagneticFluxDensityMeasure: 'MAGNETICFLUXDENSITYUNIT',
  IfcMagneticFluxMeasure: 'MAGNETICFLUXUNIT', IfcMassDensityMeasure: 'MASSDENSITYUNIT',
  IfcMassFlowRateMeasure: 'MASSFLOWRATEUNIT', IfcMassMeasure: 'MASSUNIT',
  IfcMassPerLengthMeasure: 'MASSPERLENGTHUNIT',
  IfcModulusOfElasticityMeasure: 'MODULUSOFELASTICITYUNIT',
  IfcModulusOfLinearSubgradeReactionMeasure: 'MODULUSOFLINEARSUBGRADEREACTIONUNIT',
  IfcModulusOfRotationalSubgradeReactionMeasure: 'MODULUSOFROTATIONALSUBGRADEREACTIONUNIT',
  IfcModulusOfSubgradeReactionMeasure: 'MODULUSOFSUBGRADEREACTIONUNIT',
  IfcMoistureDiffusivityMeasure: 'MOISTUREDIFFUSIVITYUNIT',
  IfcMolecularWeightMeasure: 'MOLECULARWEIGHTUNIT',
  IfcMomentOfInertiaMeasure: 'MOMENTOFINERTIAUNIT', IfcMonetaryMeasure: 'MONETARYUNIT',
  IfcNonNegativeLengthMeasure: 'LENGTHUNIT', IfcNormalisedRatioMeasure: 'NORMALISEDRATIOUNIT',
  IfcNumericMeasure: 'USERDEFINED', IfcPHMeasure: 'PHUNIT',
  IfcPlanarForceMeasure: 'PLANARFORCEUNIT', IfcPlaneAngleMeasure: 'PLANEANGLEUNIT',
  IfcPositiveLengthMeasure: 'LENGTHUNIT', IfcPositivePlaneAngleMeasure: 'PLANEANGLEUNIT',
  IfcPositiveRatioMeasure: 'RATIOUNIT', IfcPowerMeasure: 'POWERUNIT',
  IfcPressureMeasure: 'PRESSUREUNIT', IfcRadioActivityMeasure: 'RADIOACTIVITYUNIT',
  IfcRatioMeasure: 'RATIOUNIT', IfcRotationalFrequencyMeasure: 'ROTATIONALFREQUENCYUNIT',
  IfcRotationalMassMeasure: 'ROTATIONALMASSUNIT',
  IfcRotationalStiffnessMeasure: 'ROTATIONALSTIFFNESSUNIT',
  IfcSectionModulusMeasure: 'SECTIONMODULUSUNIT',
  IfcSectionalAreaIntegralMeasure: 'SECTIONALAREAINTEGRALUNIT',
  IfcShearModulusMeasure: 'SHEARMODULUSUNIT', IfcSolidAngleMeasure: 'SOLIDANGLEUNIT',
  IfcSoundPowerLevelMeasure: 'SOUNDPOWERLEVELUNIT', IfcSoundPowerMeasure: 'SOUNDPOWERUNIT',
  IfcSoundPressureLevelMeasure: 'SOUNDPRESSURELEVELUNIT',
  IfcSoundPressureMeasure: 'SOUNDPRESSUREUNIT',
  IfcSpecificHeatCapacityMeasure: 'SPECIFICHEATCAPACITYUNIT',
  IfcTemperatureGradientMeasure: 'TEMPERATUREGRADIENTUNIT',
  IfcTemperatureRateOfChangeMeasure: 'TEMPERATURERATEOFCHANGEUNIT',
  IfcThermalAdmittanceMeasure: 'THERMALADMITTANCEUNIT',
  IfcThermalConductivityMeasure: 'THERMALCONDUCTIVITYUNIT',
  IfcThermalExpansionCoefficientMeasure: 'THERMALEXPANSIONCOEFFICIENTUNIT',
  IfcThermalResistanceMeasure: 'THERMALRESISTANCEUNIT',
  IfcThermalTransmittanceMeasure: 'THERMALTRANSMITTANCEUNIT',
  IfcThermodynamicTemperatureMeasure: 'THERMODYNAMICTEMPERATUREUNIT', IfcTimeMeasure: 'TIMEUNIT',
  IfcTorqueMeasure: 'TORQUEUNIT', IfcVaporPermeabilityMeasure: 'VAPORPERMEABILITYUNIT',
  IfcVolumeMeasure: 'VOLUMEUNIT', IfcVolumetricFlowRateMeasure: 'VOLUMETRICFLOWRATEUNIT',
  IfcWarpingConstantMeasure: 'WARPINGCONSTANTUNIT', IfcWarpingMomentMeasure: 'WARPINGMOMENTUNIT'
}

/** The engine's kind for each named unit type; every other unit type is `none`. */
const KIND_OF: Record<string, string> = {
  LENGTHUNIT: 'length',
  AREAUNIT: 'area',
  VOLUMEUNIT: 'volume',
  PLANEANGLEUNIT: 'angle',
  MASSUNIT: 'mass',
  COUNTUNIT: 'count'
}

describe('a measure is converted by its exact type, never by a part of its name', () => {
  it('names every IFC measure’s unit type as IfcOpenShell does', () => {
    expect(Object.keys(IFCOPENSHELL_UNIT_TYPE)).toHaveLength(92)
    for (const [measure, unitType] of Object.entries(IFCOPENSHELL_UNIT_TYPE)) {
      expect(measureUnitType(measure), measure).toBe(unitType)
    }
  })

  it('gives a kind only to the measures whose unit type is that kind, in any case', () => {
    for (const [measure, unitType] of Object.entries(IFCOPENSHELL_UNIT_TYPE)) {
      const kind = KIND_OF[unitType] ?? 'none'
      expect(measureKind(measure), measure).toBe(kind)
      expect(measureKind(measure.toUpperCase()), measure).toBe(kind)
    }
    // The three a substring match misread.
    expect(measureKind('IFCMASSPERLENGTHMEASURE')).toBe('none')
    expect(measureKind('IFCROTATIONALMASSMEASURE')).toBe('none')
    expect(measureKind('IFCCOMPOUNDPLANEANGLEMEASURE')).toBe('none')
    expect(measureKind(undefined)).toBe('none')
  })

  it('keeps a compound measure with no assigned unit as written in the schedule', async () => {
    for (const guid of ['000000000000000000000E', '000000000000000000000F']) {
      const { cells } = await coreOf(guid)
      // Millimetres and pounds are assigned: neither may touch these.
      expect(cells['SGVue_Edge.LinearMass']).toEqual({ v: 12.5 })
      expect(cells['SGVue_Edge.RotationalMass']).toEqual({ v: 3.25 })
    }
  })
})

describe('Building and Site come from the element’s own container', () => {
  it('a wall contained in the building, in no storey, has its Building and Site', async () => {
    const el = await byGuid('000000000000000000000I')
    expect(el.storey).toBe('')
    const building = (await edge).building!
    expect(el.container).toBe(building.expressId)
    const { core } = await coreOf('000000000000000000000I')
    expect(core.storey).toBe('')
    expect(core.storeyElevation).toBeNull()
    expect(core.building).toBe('Building')
    expect(core.site).toBe('Site')
    expect(core.space).toBe('')
  })

  it('a wall in a storey keeps its Building and Site, and no space', async () => {
    const { core } = await coreOf('000000000000000000000E')
    expect([core.storey, core.building, core.site, core.space]).toEqual(['Level 00', 'Building', 'Site', ''])
  })
})

describe('Room / Space comes from the element’s own container', () => {
  it('furniture contained in a space names the room, and stays on the storey above it', async () => {
    const el = await byGuid('000000000000000000000J')
    const room = await byGuid('0000000000000000000009')
    expect(el.container).toBe(room.expressId)
    // The main window's Level is unchanged: the storey that aggregates the room.
    expect(el.storey).toBe('Level 00')
    const { core } = await coreOf('000000000000000000000J')
    expect([core.storey, core.building, core.site, core.space]).toEqual(['Level 00', 'Building', 'Site', 'Meeting room'])
  })

  it('a space is held by the storey aggregating it, and names itself', async () => {
    const room = await byGuid('0000000000000000000009')
    const storey = (await edge).storeys.find((s) => s.name === 'Level 00')!
    expect(room.container).toBe(storey.expressId)
    const { core } = await coreOf('0000000000000000000009')
    expect([core.storey, core.building, core.site, core.space]).toEqual(['Level 00', 'Building', 'Site', 'Meeting room'])
  })
})
