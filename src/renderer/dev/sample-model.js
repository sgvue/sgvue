// Sample 4-storey block — geometry in metres, Z up. Boxes: {s:[sx,sy,sz], p:[cx,cy,cz]}
const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
function guid(i) { let x = (i * 2654435761) >>> 0, s = ''; for (let k = 0; k < 22; k++) { x = (x * 1103515245 + 12345) >>> 0; s += CH[(x >>> 8) % 64]; } return s; }

export const COLORS = {
  concrete: { color: 0x9aa5a3 }, slab: { color: 0xb4bcba }, extwall: { color: 0xd8d2c6 }, intwall: { color: 0xe4e1da },
  glass: { color: 0x7fb5b0, opacity: 0.42 }, frame: { color: 0x4a5556 }, door: { color: 0x8c7b66 }, stair: { color: 0xa3adab },
  duct: { color: 0x8fa3b5 }, footing: { color: 0x8a9492 },
  turf: { color: 0x8fae82 }, foliage: { color: 0x7d9e6f }, trunk: { color: 0x6b5a45 }, planter: { color: 0xb0aa9c },
};

export function buildModel() {
  const storeys = [
    { name: 'Foundation', elev: -1.0, h: 1.0 }, { name: 'L1', elev: 0, h: 4.0 }, { name: 'L2', elev: 4.0, h: 3.5 },
    { name: 'L3', elev: 7.5, h: 3.5 }, { name: 'L4', elev: 11.0, h: 3.5 }, { name: 'Roof', elev: 14.5, h: 1.2 },
  ];
  const gx = ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({ name: n, axis: 'x', v: i * 6 }));
  const gy = ['1', '2', '3', '4'].map((n, i) => ({ name: n, axis: 'y', v: i * 6 }));
  const floors = storeys.slice(1, 5);
  const els = []; let nextId = 100;
  const box = (sx, sy, sz, cx, cy, cz) => ({ s: [sx, sy, sz], p: [cx, cy, cz] });
  const add = (o) => { const id = nextId++; els.push({ id, guid: guid(id), tag: String(200000 + id), predefinedType: 'NOTDEFINED', psets: {}, qto: {}, ...o }); };
  const r2 = (v) => Math.round(v * 100) / 100;

  // wall with rectangular openings, axis aligned
  function wallBoxes(x0, y0, x1, y1, zb, h, t, ops) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, out = [];
    const seg = (a, b, z, hh) => { if (b - a < 1e-6 || hh < 1e-6) return; out.push(box(Math.abs(ux) * (b - a) + Math.abs(uy) * t, Math.abs(uy) * (b - a) + Math.abs(ux) * t, hh, x0 + ux * (a + b) / 2, y0 + uy * (a + b) / 2, z + hh / 2)); };
    let cur = 0;
    for (const o of [...ops].sort((a, b) => a.o - b.o)) { seg(cur, o.o, zb, h); seg(o.o, o.o + o.w, zb, o.sill); seg(o.o, o.o + o.w, zb + o.sill + o.hh, h - o.sill - o.hh); cur = o.o + o.w; }
    seg(cur, L, zb, h);
    return out;
  }
  // window/door parts centred at (cx,cy,cz), width w, height hh, along x (dir 'x') or y
  function frameParts(cx, cy, cz, w, hh, dir, leafColor, leafT) {
    const a = dir === 'x';
    const B = (len, dep, hgt, ox, oy, oz) => box(a ? len : dep, a ? dep : len, hgt, cx + (a ? ox : oy), cy + (a ? oy : ox), cz + oz);
    const f = 0.06, d = 0.12;
    return [
      { color: 'frame', boxes: [B(w, d, f, 0, 0, hh / 2 - f / 2), B(w, d, f, 0, 0, -hh / 2 + f / 2), B(f, d, hh, -w / 2 + f / 2, 0, 0), B(f, d, hh, w / 2 - f / 2, 0, 0)] },
      { color: leafColor, boxes: [B(w - 2 * f, leafT, hh - 2 * f, 0, 0, 0)] },
    ];
  }

  // Footings + ground slab
  for (const X of gx) for (const Y of gy) add({
    type: 'IfcFooting', predefinedType: 'PAD_FOOTING', objectType: 'PF1 1500x1500x500', name: `Footing ${X.name}-${Y.name}`, storey: 'Foundation', material: 'Concrete C32/40',
    color: 'footing', boxes: [box(1.5, 1.5, 0.5, X.v, Y.v, -0.75)],
    psets: { Pset_FootingCommon: { Reference: 'PF1', LoadBearing: true, IsExternal: false } }, qto: { Qto_FootingBaseQuantities: { Length: 1500, Width: 1500, Height: 500, Volume: r2(1.125) } },
  });
  add({ type: 'IfcSlab', predefinedType: 'BASESLAB', objectType: 'Slab 200 RC', name: 'Ground Slab', storey: 'L1', material: 'Concrete C32/40', color: 'slab', boxes: [box(24.6, 18.6, 0.2, 12, 9, -0.1)],
    psets: { Pset_SlabCommon: { Reference: 'GS', IsExternal: false, LoadBearing: true, FireRating: '2 HR', PitchAngle: 0 } }, qto: { Qto_SlabBaseQuantities: { Width: 200, GrossArea: r2(24.6 * 18.6), Perimeter: 86400 } } });

  for (const f of floors) {
    const hw = f.h - 0.2, top = f.elev + f.h, isL1 = f.name === 'L1';
    // Columns
    for (const X of gx) for (const Y of gy) {
      const ext = X === gx[0] || X === gx[4] || Y === gy[0] || Y === gy[3];
      const zb = isL1 ? -0.5 : f.elev, hc = top - zb;
      add({ type: 'IfcColumn', predefinedType: 'COLUMN', objectType: 'RC Column 400x400', name: `Column ${X.name}-${Y.name} ${f.name}`, storey: f.name, material: 'Concrete C40/50', color: 'concrete',
        boxes: [box(0.4, 0.4, hc, X.v, Y.v, zb + hc / 2)],
        psets: { Pset_ColumnCommon: { Reference: 'C1', IsExternal: ext, LoadBearing: true, FireRating: '2 HR', Slope: 0 } }, qto: { Qto_ColumnBaseQuantities: { Length: Math.round(hc * 1000), CrossSectionArea: 0.16, GrossVolume: r2(0.16 * hc) } } });
    }
    // Beams
    const zc = top - 0.5;
    for (const Y of gy) for (let i = 0; i < 4; i++) add({ type: 'IfcBeam', predefinedType: 'BEAM', objectType: 'RC Beam 300x600', name: `Beam ${gx[i].name}${gx[i + 1].name}/${Y.name} ${f.name}`, storey: f.name, material: 'Concrete C40/50', color: 'concrete',
      boxes: [box(5.6, 0.3, 0.6, gx[i].v + 3, Y.v, zc)], psets: { Pset_BeamCommon: { Reference: 'B1', IsExternal: Y === gy[0] || Y === gy[3], LoadBearing: true, FireRating: '2 HR', Span: 5600 } }, qto: { Qto_BeamBaseQuantities: { Length: 5600, CrossSectionArea: 0.18, GrossVolume: r2(0.18 * 5.6) } } });
    for (const X of gx) for (let j = 0; j < 3; j++) add({ type: 'IfcBeam', predefinedType: 'BEAM', objectType: 'RC Beam 300x600', name: `Beam ${X.name}/${gy[j].name}${gy[j + 1].name} ${f.name}`, storey: f.name, material: 'Concrete C40/50', color: 'concrete',
      boxes: [box(0.3, 5.6, 0.6, X.v, gy[j].v + 3, zc)], psets: { Pset_BeamCommon: { Reference: 'B1', IsExternal: X === gx[0] || X === gx[4], LoadBearing: true, FireRating: '2 HR', Span: 5600 } }, qto: { Qto_BeamBaseQuantities: { Length: 5600, CrossSectionArea: 0.18, GrossVolume: r2(0.18 * 5.6) } } });
    // Floor slab above (with stair well), belongs to next storey
    if (f.name !== 'L4') {
      const nx = storeys[storeys.indexOf(f) + 1], z = top - 0.1;
      add({ type: 'IfcSlab', predefinedType: 'FLOOR', objectType: 'Slab 200 RC', name: `Floor Slab ${nx.name}`, storey: nx.name, material: 'Concrete C32/40', color: 'slab',
        boxes: [box(13.1, 18.6, 0.2, 6.25, 9, z), box(7.1, 18.6, 0.2, 20.75, 9, z), box(4.4, 7.1, 0.2, 15, 3.25, z), box(4.4, 8.6, 0.2, 15, 14.0, z)],
        psets: { Pset_SlabCommon: { Reference: 'FS', IsExternal: false, LoadBearing: true, FireRating: '2 HR', PitchAngle: 0 } }, qto: { Qto_SlabBaseQuantities: { Width: 200, GrossArea: r2(24.6 * 18.6 - 4.4 * 2.9), Perimeter: 86400 } } });
    }
    // External walls + windows/doors
    const win = { o: 1.6, w: 2.4, sill: 0.9, hh: 1.5 }, dr = { o: 1.6, w: 2.4, sill: 0, hh: 2.4 };
    const extWall = (name, x0, y0, x1, y1, op, dir) => {
      const L = Math.hypot(x1 - x0, y1 - y0);
      add({ type: 'IfcWall', predefinedType: 'SOLIDWALL', objectType: 'EW 200 Brick', name, storey: f.name, material: 'Clay brick, plastered', color: 'extwall', boxes: wallBoxes(x0, y0, x1, y1, f.elev, hw, 0.2, [op]),
        psets: { Pset_WallCommon: { Reference: 'EW200', IsExternal: true, LoadBearing: false, FireRating: '1 HR', ThermalTransmittance: 1.9 } }, qto: { Qto_WallBaseQuantities: { Length: Math.round(L * 1000), Height: Math.round(hw * 1000), Width: 200, GrossSideArea: r2(L * hw), NetSideArea: r2(L * hw - op.w * op.hh) } } });
      const cx = x0 + (dir === 'x' ? op.o + op.w / 2 : 0), cy = y0 + (dir === 'y' ? op.o + op.w / 2 : 0), cz = f.elev + op.sill + op.hh / 2;
      if (op === dr) add({ type: 'IfcDoor', predefinedType: 'DOOR', objectType: 'D2 Double 2400x2400', name: `Entrance Door ${f.name}`, storey: f.name, material: 'Aluminium, glazed', parts: frameParts(cx, cy, cz, op.w, op.hh, dir, 'glass', 0.05),
        psets: { Pset_DoorCommon: { Reference: 'D2', IsExternal: true, FireRating: '-', FireExit: true, HandicapAccessible: true } }, qto: { Qto_DoorBaseQuantities: { Width: 2400, Height: 2400, Area: 5.76 } } });
      else add({ type: 'IfcWindow', predefinedType: 'WINDOW', objectType: 'W1 2400x1500', name: `Window ${name.replace('Ext Wall ', '')}`, storey: f.name, material: 'Aluminium, double glazed', parts: frameParts(cx, cy, cz, op.w, op.hh, dir, 'glass', 0.03),
        psets: { Pset_WindowCommon: { Reference: 'W1', IsExternal: true, FireRating: '-', GlazingAreaFraction: 0.82, ThermalTransmittance: 2.6, SmokeStop: false } }, qto: { Qto_WindowBaseQuantities: { Width: 2400, Height: 1500, Area: 3.6 } } });
    };
    for (let i = 0; i < 4; i++) {
      const x0 = gx[i].v + 0.2, x1 = gx[i + 1].v - 0.2, tag = `${gx[i].name}-${gx[i + 1].name}`;
      extWall(`Ext Wall S ${tag} ${f.name}`, x0, 0, x1, 0, isL1 && i === 1 ? dr : win, 'x');
      extWall(`Ext Wall N ${tag} ${f.name}`, x0, 18, x1, 18, win, 'x');
    }
    for (let j = 0; j < 3; j++) {
      const y0 = gy[j].v + 0.2, y1 = gy[j + 1].v - 0.2, tag = `${gy[j].name}-${gy[j + 1].name}`;
      extWall(`Ext Wall W ${tag} ${f.name}`, 0, y0, 0, y1, win, 'y');
      extWall(`Ext Wall E ${tag} ${f.name}`, 24, y0, 24, y1, win, 'y');
    }
    // Core walls
    const core = (name, boxes, L) => add({ type: 'IfcWall', predefinedType: 'SOLIDWALL', objectType: 'Core Wall 250 RC', name, storey: f.name, material: 'Concrete C40/50', color: 'concrete', boxes,
      psets: { Pset_WallCommon: { Reference: 'CW250', IsExternal: false, LoadBearing: true, FireRating: '2 HR' } }, qto: { Qto_WallBaseQuantities: { Length: Math.round(L * 1000), Height: Math.round(hw * 1000), Width: 250, GrossSideArea: r2(L * hw) } } });
    core(`Core Wall W ${f.name}`, [box(0.25, 3.5, hw, 12.5, 8.25, f.elev + hw / 2)], 3.5);
    core(`Core Wall E ${f.name}`, [box(0.25, 3.5, hw, 17.5, 8.25, f.elev + hw / 2)], 3.5);
    core(`Core Wall N ${f.name}`, wallBoxes(12.375, 10, 17.625, 10, f.elev, hw, 0.25, [{ o: 0.75, w: 0.9, sill: 0, hh: 2.1 }]), 5.25);
    const intDoor = (name, cx, cy, dir) => add({ type: 'IfcDoor', predefinedType: 'DOOR', objectType: 'D1 Single 900x2100', name, storey: f.name, material: 'Timber, solid core', parts: frameParts(cx, cy, f.elev + 1.05, 0.9, 2.1, dir, 'door', 0.045),
      psets: { Pset_DoorCommon: { Reference: 'D1', IsExternal: false, FireRating: '1 HR', FireExit: false, HandicapAccessible: true } }, qto: { Qto_DoorBaseQuantities: { Width: 900, Height: 2100, Area: 1.89 } } });
    intDoor(`Core Door ${f.name}`, 13.575, 10, 'x');
    // Partitions
    const part = (name, boxes, L) => add({ type: 'IfcWall', predefinedType: 'PARTITIONING', objectType: 'IW 150 Drywall', name, storey: f.name, material: 'Gypsum board on steel stud', color: 'intwall', boxes,
      psets: { Pset_WallCommon: { Reference: 'IW150', IsExternal: false, LoadBearing: false, FireRating: '1 HR', AcousticRating: 'STC 45' } }, qto: { Qto_WallBaseQuantities: { Length: Math.round(L * 1000), Height: Math.round(hw * 1000), Width: 150, GrossSideArea: r2(L * hw) } } });
    part(`Corridor Wall ${f.name}`, wallBoxes(0.3, 9, 12.3, 9, f.elev, hw, 0.15, [{ o: 2.0, w: 0.9, sill: 0, hh: 2.1 }, { o: 8.0, w: 0.9, sill: 0, hh: 2.1 }]), 12);
    intDoor(`Room Door ${f.name}-01`, 2.75, 9, 'x'); intDoor(`Room Door ${f.name}-02`, 8.75, 9, 'x');
    part(`Partition B ${f.name}`, wallBoxes(6, 9.15, 6, 17.7, f.elev, hw, 0.15, [{ o: 1.5, w: 0.9, sill: 0, hh: 2.1 }]), 8.55);
    intDoor(`Room Door ${f.name}-03`, 6, 11.1, 'y');
    // Stair (half turn) L1..L3
    if (f.name !== 'L4') {
      const r = f.h / 20, zb = f.elev, bx = [];
      for (let i = 0; i < 10; i++) bx.push(box(0.28, 1.2, (i + 1) * r, 13.0 + 0.28 * i + 0.14, 7.6, zb + (i + 1) * r / 2));
      bx.push(box(1.2, 2.5, 10 * r, 16.4, 8.25, zb + 5 * r));
      for (let j = 0; j < 10; j++) bx.push(box(0.28, 1.2, (11 + j) * r, 15.8 - 0.28 * j - 0.14, 8.9, zb + (11 + j) * r / 2));
      add({ type: 'IfcStair', predefinedType: 'HALF_TURN_STAIR', objectType: 'ST1 RC Stair', name: `Stair ${f.name}`, storey: f.name, material: 'Concrete C32/40', color: 'stair', boxes: bx,
        psets: { Pset_StairCommon: { Reference: 'ST1', NumberOfRiser: 20, NumberOfTreads: 19, RiserHeight: Math.round(r * 1000), TreadLength: 280, IsExternal: false, FireExit: true, HandicapAccessible: false } }, qto: { Qto_StairFlightBaseQuantities: { Length: 5600, GrossVolume: r2(2.8 * 1.2 * f.h) } } });
    }
    // Ducts
    const zd = top - 1.1;
    add({ type: 'IfcDuctSegment', predefinedType: 'RIGIDSEGMENT', objectType: 'Supply Duct 600x400', name: `Duct Main ${f.name}`, storey: f.name, material: 'Galvanised steel', color: 'duct', boxes: [box(11.5, 0.6, 0.4, 6.0, 8.4, zd)],
      psets: { Pset_DuctSegmentTypeCommon: { Shape: 'RECTANGULAR', NominalWidth: 600, NominalHeight: 400, WorkingPressure: 500, Reference: 'SD-600x400' } }, qto: { Qto_DuctSegmentBaseQuantities: { Length: 11500, GrossWeight: r2(11.5 * 9.4) } } });
    add({ type: 'IfcDuctSegment', predefinedType: 'RIGIDSEGMENT', objectType: 'Supply Duct 400x400', name: `Duct Branch ${f.name}`, storey: f.name, material: 'Galvanised steel', color: 'duct', boxes: [box(0.4, 7.6, 0.4, 9.0, 13.9, zd)],
      psets: { Pset_DuctSegmentTypeCommon: { Shape: 'RECTANGULAR', NominalWidth: 400, NominalHeight: 400, WorkingPressure: 500, Reference: 'SD-400x400' } }, qto: { Qto_DuctSegmentBaseQuantities: { Length: 7600, GrossWeight: r2(7.6 * 7.5) } } });
  }
  // Roof slab + parapets
  add({ type: 'IfcSlab', predefinedType: 'ROOF', objectType: 'Slab 200 RC', name: 'Roof Slab', storey: 'Roof', material: 'Concrete C32/40', color: 'slab', boxes: [box(24.6, 18.6, 0.2, 12, 9, 14.4)],
    psets: { Pset_SlabCommon: { Reference: 'RS', IsExternal: true, LoadBearing: true, FireRating: '2 HR', PitchAngle: 0 } }, qto: { Qto_SlabBaseQuantities: { Width: 200, GrossArea: r2(24.6 * 18.6), Perimeter: 86400 } } });
  const para = (name, b, L) => add({ type: 'IfcWall', predefinedType: 'PARAPET', objectType: 'Parapet 200 RC', name, storey: 'Roof', material: 'Concrete C32/40', color: 'extwall', boxes: [b],
    psets: { Pset_WallCommon: { Reference: 'PP200', IsExternal: true, LoadBearing: false, FireRating: '-' } }, qto: { Qto_WallBaseQuantities: { Length: Math.round(L * 1000), Height: 1000, Width: 200 } } });
  para('Parapet S', box(24.6, 0.2, 1.0, 12, -0.2, 15.0), 24.6); para('Parapet N', box(24.6, 0.2, 1.0, 12, 18.2, 15.0), 24.6);
  para('Parapet W', box(0.2, 18.2, 1.0, -0.2, 9, 15.0), 18.2); para('Parapet E', box(0.2, 18.2, 1.0, 24.2, 9, 15.0), 18.2);

  // Site context: turf areas and street trees around the block, at grade. Trees are box proxies —
  // the way planting usually arrives in an IFC, a trunk plus a stepped crown rather than a mesh.
  const turf = (name, sx, sy, cx, cy) => add({
    type: 'IfcGeographicElement', predefinedType: 'TERRAIN', objectType: 'Turf \u2014 Cow Grass', name, storey: 'L1',
    material: 'Cow grass on 300mm topsoil', color: 'turf', boxes: [box(sx, sy, 0.1, cx, cy, -0.05)],
    psets: { Pset_GeographicElementCommon: { Reference: 'TF', IsExternal: true }, SGPset_SoftLandscape: { SurfaceType: 'TURF', TopsoilDepth: 300, Irrigated: false, PermeableArea: true } },
    qto: { Qto_GeographicElementBaseQuantities: { GrossArea: r2(sx * sy), Perimeter: Math.round((sx + sy) * 2 * 1000) } },
  });
  turf('Turf Area S', 40.0, 7.7, 12, -4.15); turf('Turf Area N', 40.0, 7.7, 12, 22.15);
  turf('Turf Area W', 7.7, 18.6, -4.15, 9); turf('Turf Area E', 7.7, 18.6, 28.15, 9);

  const SPECIES = [
    { n: 'Angsana', bot: 'Pterocarpus indicus', girth: 200, crown: 6.0, ht: 7.5 },
    { n: 'Tembusu', bot: 'Fagraea fragrans', girth: 150, crown: 4.5, ht: 6.2 },
  ];
  let treeN = 0;
  const tree = (cx, cy, si) => {
    const sp = SPECIES[si]; treeN++;
    const c = sp.crown, clear = sp.ht - c * 0.62;
    add({
      type: 'IfcGeographicElement', predefinedType: 'VEGETATION', objectType: `${sp.n} ${sp.girth}mm girth`,
      name: `Tree T${String(treeN).padStart(2, '0')} ${sp.n}`, storey: 'L1', material: 'Planting \u2014 existing tree to retain',
      parts: [
        { color: 'planter', boxes: [box(1.8, 1.8, 0.15, cx, cy, 0.02)] },
        { color: 'trunk', boxes: [box(sp.girth / 636, sp.girth / 636, clear, cx, cy, clear / 2)] },
        { color: 'foliage', boxes: [
          box(c, c, c * 0.34, cx, cy, clear + c * 0.17),
          box(c * 0.74, c * 0.74, c * 0.26, cx, cy, clear + c * 0.47),
          box(c * 0.42, c * 0.42, c * 0.2, cx, cy, clear + c * 0.7),
        ] },
      ],
      psets: {
        Pset_GeographicElementCommon: { Reference: `TR-${sp.girth}`, IsExternal: true },
        SGPset_Planting: { SpeciesCommonName: sp.n, SpeciesBotanicalName: sp.bot, GirthAtBreastHeight: sp.girth, CrownDiameter: Math.round(c * 1000), PlantingHeight: Math.round(sp.ht * 1000), ToBeRetained: true },
      },
      qto: { Qto_GeographicElementBaseQuantities: { GrossArea: r2(Math.PI * (c / 2) ** 2) } },
    });
  };
  for (let i = 0; i < 5; i++) { tree(1 + i * 5.5, -4.0, i % 2); tree(1 + i * 5.5, 22.0, (i + 1) % 2); }
  for (let i = 0; i < 3; i++) { tree(-4.0, 2.5 + i * 6.5, i % 2); tree(28.0, 2.5 + i * 6.5, (i + 1) % 2); }

  return {
    project: { name: 'Sample Block', file: 'Sample_Block_R25.ifc', schema: 'IFC4', site: 'Lot 1234 Tampines', building: 'Block 1' },
    storeys, grids: [...gx, ...gy], elements: els,
  };
}

// Discipline files a federated project is typically made of. Each is a complete shell model on its own.
export const SAMPLE_FILES = [
  { key: 'ARC', name: 'Architecture', file: 'SB_ARC_R25.ifc', discipline: 'ARC', swatch: '#D8D2C6' },
  { key: 'STR', name: 'Structure', file: 'SB_STR_R25.ifc', discipline: 'STR', swatch: '#9AA5A3' },
  { key: 'SIT', name: 'Site & Landscape', file: 'SB_SIT_R25.ifc', discipline: 'SIT', swatch: '#8FAE82' },
  { key: 'MEP', name: 'Mechanical', file: 'SB_MEP_R25.ifc', discipline: 'MEP', swatch: '#8FA3B5' },
];
const STR_TYPES = new Set(['IfcFooting', 'IfcSlab', 'IfcColumn', 'IfcBeam', 'IfcStair']);
const disciplineOf = (e) => e.type === 'IfcGeographicElement' ? 'SIT' : e.type === 'IfcDuctSegment' ? 'MEP' : STR_TYPES.has(e.type) || e.objectType === 'Core Wall 250 RC' ? 'STR' : 'ARC';
export function buildDisciplineModel(key) {
  const full = buildModel(), f = SAMPLE_FILES.find((x) => x.key === key);
  const elements = full.elements.filter((e) => disciplineOf(e) === key);
  const used = new Set(elements.map((e) => e.storey));
  return { ...full, project: { ...full.project, name: f.name, file: f.file, discipline: key }, storeys: full.storeys.filter((s) => used.has(s.name)), grids: key === 'MEP' || key === 'SIT' ? [] : full.grids, elements };
}

// Federation: merge several shell models into one. Ids are offset per model so they stay unique; every element is
// tagged with `model` (the file key) so the shell can filter, hide and colour by source file.
export function federate(models) {
  const storeys = new Map(), grids = new Map(), elements = [];
  models.forEach((m, i) => {
    const base = i * 1000000;
    m.storeys.forEach((s) => { if (!storeys.has(s.name)) storeys.set(s.name, s); });
    m.grids.forEach((g) => { if (!grids.has(g.name)) grids.set(g.name, g); });
    m.elements.forEach((e) => elements.push({ ...e, id: base + e.id, localId: e.id, model: m.project.discipline || m.project.file }));
  });
  const first = models[0] ? models[0].project : { name: '', schema: '', site: '', building: '' };
  return { project: { ...first, name: first.building || first.name, file: models.map((m) => m.project.file).join(' + ') }, storeys: [...storeys.values()].sort((a, b) => a.elev - b.elev), grids: [...grids.values()], elements, files: models.map((m) => m.project) };
}
