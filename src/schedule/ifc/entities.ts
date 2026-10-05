// web-ifc reports entity names in upper case ("IFCWALLSTANDARDCASE"). This restores
// canonical IFC casing for display and template matching. Common names map exactly;
// unknown names fall back to a naive re-case.
// Lifted from ALpha BIM Viewer/src/shared/ifc-entities.ts.

export type Discipline = 'ARC' | 'STR' | 'MEP' | 'OTHER';

/** Every IFC class this app knows by name. Read-only — the lookup below is built from it. */
export const CANONICAL_ENTITIES: readonly string[] = [
  'IfcWall', 'IfcWallStandardCase', 'IfcColumn', 'IfcBeam', 'IfcMember', 'IfcPlate', 'IfcSlab',
  'IfcDoor', 'IfcWindow', 'IfcSpace', 'IfcRailing', 'IfcStair', 'IfcStairFlight', 'IfcRamp',
  'IfcRampFlight', 'IfcRoof', 'IfcCovering', 'IfcCurtainWall', 'IfcBuildingElementProxy',
  'IfcFurnishingElement', 'IfcFurniture', 'IfcSanitaryTerminal', 'IfcFireSuppressionTerminal',
  'IfcFlowTerminal', 'IfcFlowSegment', 'IfcFlowFitting', 'IfcPipeSegment', 'IfcPipeFitting',
  'IfcDuctSegment', 'IfcDuctFitting', 'IfcCableCarrierSegment', 'IfcCableSegment', 'IfcAirTerminal',
  'IfcValve', 'IfcPump', 'IfcTank', 'IfcBoiler', 'IfcGeographicElement', 'IfcCivilElement',
  'IfcFooting', 'IfcPile', 'IfcReinforcingBar', 'IfcReinforcingMesh', 'IfcBuildingStorey',
  'IfcBuilding', 'IfcSite', 'IfcProject', 'IfcOpeningElement', 'IfcDiscreteAccessory',
  'IfcTransportElement', 'IfcLightFixture', 'IfcOutlet', 'IfcSensor', 'IfcAlarm', 'IfcActuator',
  'IfcController', 'IfcUnitaryEquipment', 'IfcDistributionChamberElement', 'IfcShadingDevice',
  'IfcElementAssembly', 'IfcWasteTerminal', 'IfcFlowMeter', 'IfcDamper', 'IfcInterceptor',
  'IfcChiller', 'IfcCoil', 'IfcFan', 'IfcFilter', 'IfcSpaceHeater', 'IfcElectricAppliance',
  'IfcElectricDistributionBoard', 'IfcSwitchingDevice', 'IfcJunctionBox', 'IfcProtectiveDevice',
  'IfcCommunicationsAppliance', 'IfcAudioVisualAppliance', 'IfcMedicalDevice', 'IfcSolarDevice',
  'IfcAirToAirHeatRecovery', 'IfcCooledBeam', 'IfcCoolingTower', 'IfcEvaporator', 'IfcCondenser',
  'IfcCompressor', 'IfcMotorConnection', 'IfcTransformer', 'IfcElectricGenerator',
  'IfcElectricMotor', 'IfcElectricFlowStorageDevice', 'IfcBurner', 'IfcHumidifier',
  'IfcTendon', 'IfcTendonAnchor', 'IfcRoofType', 'IfcAnnotation', 'IfcVirtualElement',
  'IfcGrid', 'IfcSystem', 'IfcZone', 'IfcGroup', 'IfcBuildingElementPart', 'IfcMechanicalFastener',
  'IfcFastener', 'IfcVibrationIsolator', 'IfcBearing', 'IfcCourse', 'IfcEarthworksFill',
];

const CANONICAL: Record<string, string> = {};
CANONICAL_ENTITIES.forEach((n) => { CANONICAL[n.toUpperCase()] = n; });

export function normalizeEntity(upper: string): string {
  const hit = CANONICAL[upper];
  if (hit) return hit;
  if (!upper.startsWith('IFC')) return upper;
  return 'Ifc' + upper.slice(3).charAt(0) + upper.slice(4).toLowerCase();
}

// Coarse discipline inference, used when the model carries no discipline tag.
const STR = new Set(['IfcColumn', 'IfcBeam', 'IfcMember', 'IfcPlate', 'IfcSlab', 'IfcFooting',
  'IfcPile', 'IfcReinforcingBar', 'IfcReinforcingMesh', 'IfcTendon', 'IfcTendonAnchor',
  'IfcBearing', 'IfcElementAssembly']);
const MEP = new Set(['IfcFlowTerminal', 'IfcFlowSegment', 'IfcFlowFitting', 'IfcPipeSegment',
  'IfcPipeFitting', 'IfcDuctSegment', 'IfcDuctFitting', 'IfcCableCarrierSegment', 'IfcCableSegment',
  'IfcAirTerminal', 'IfcValve', 'IfcPump', 'IfcTank', 'IfcBoiler', 'IfcSanitaryTerminal',
  'IfcFireSuppressionTerminal', 'IfcLightFixture', 'IfcOutlet', 'IfcSensor', 'IfcAlarm',
  'IfcActuator', 'IfcController', 'IfcUnitaryEquipment', 'IfcDistributionChamberElement',
  'IfcFlowMeter', 'IfcDamper', 'IfcWasteTerminal', 'IfcInterceptor', 'IfcChiller', 'IfcCoil',
  'IfcFan', 'IfcFilter', 'IfcSpaceHeater', 'IfcElectricAppliance', 'IfcElectricDistributionBoard',
  'IfcSwitchingDevice', 'IfcJunctionBox', 'IfcProtectiveDevice', 'IfcCommunicationsAppliance',
  'IfcAudioVisualAppliance', 'IfcMedicalDevice', 'IfcSolarDevice', 'IfcCompressor',
  'IfcCondenser', 'IfcEvaporator', 'IfcCoolingTower', 'IfcTransformer', 'IfcHumidifier']);
const ARC = new Set(['IfcWall', 'IfcWallStandardCase', 'IfcDoor', 'IfcWindow', 'IfcSpace',
  'IfcRailing', 'IfcStair', 'IfcStairFlight', 'IfcRamp', 'IfcRampFlight', 'IfcRoof', 'IfcCovering',
  'IfcCurtainWall', 'IfcFurnishingElement', 'IfcFurniture', 'IfcShadingDevice',
  'IfcBuildingElementPart', 'IfcTransportElement']);

export function disciplineForEntity(entity: string): Discipline {
  if (STR.has(entity)) return 'STR';
  if (MEP.has(entity)) return 'MEP';
  if (ARC.has(entity)) return 'ARC';
  return 'OTHER';
}
