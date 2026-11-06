"""Import the PALEOMAP PaleoDEMs and plate model into WikiWorldModel's field format.

    python paleomap.py fields <request.json>
    python paleomap.py blocks <request.json>
    python paleomap.py points <request.json>

`fields` normalizes each PaleoDEM snapshot in the requested age range onto one grid
(360 x 181 nodes: longitude -180..179, latitude 90..-90, 1 degree) and assigns every node
the plate that contains it at that age, by partitioning with the PALEOMAP plate polygons
reconstructed to that age. Nodes outside every polygon get plate 0 (they do not move).
It writes, per snapshot, `elev/<age>.i16` (int16 metres) and `plate/<age>.u16` (uint16
plate id), little-endian, row-major from the north-west corner, plus `meta.json`.

`blocks` does the partition alone, on the same grid, at the requested ages: where the plate
model puts its continental blocks when there is no elevation grid. A polygon whose plate
has no rotation at an age is left out at that age, since the model does not say where it
was. It writes `plate/<age>.u16` and `meta.json`.

`points` resolves present-day points to the plate polygon that contains them, and reports
whether that polygon exists over the requested ages.

Source corrections (all listed in meta.json, per snapshot):
  - The two pole rows each represent a single point, so each is set to the median of the
    source row. This also removes the colour-scale marker values that some snapshots carry
    in their first node (for example 10500 m at 90N, 180W).
  - Snapshots on a 360 x 180 grid (150-395 Ma) lack the 90S row; it is set to the median of
    the 89S row.
  - Snapshots on a 361 x 181 grid repeat the 180 meridian. The copy at 180E is dropped and
    the 180W column kept: in some snapshots the 180E column matches neither neighbour.
  - Remaining values above 8849 m (higher than the summit of Everest, so impossible as a
    1-degree average) are replaced by the median of their valid neighbours.
"""
import hashlib
import json
import os
import sys

import numpy as np
import pyarrow.parquet as pq
import pygplates

WIDTH, HEIGHT = 360, 181
MAX_ELEVATION = 8849.0


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def load_snapshot(pf, index, rg):
    w, h = rg['width'], rg['height']
    t = pf.read_row_group(index, columns=['longitude', 'latitude', 'elevation_m'])
    lon = t.column('longitude').to_numpy().reshape(h, w)
    lat = t.column('latitude').to_numpy().reshape(h, w)
    el = t.column('elevation_m').to_numpy().reshape(h, w).astype(np.float64)
    if not np.allclose(lon, np.arange(-180, -180 + w)[None, :]) or not np.allclose(lat, (90 - np.arange(h))[:, None], atol=1e-6):
        raise ValueError(f'{rg["ageMa"]} Ma: unexpected grid layout')
    notes = []
    if w == 361:
        diff = np.abs(el[1:-1, 0] - el[1:-1, 360])
        notes.append({'fix': 'duplicate-180E-column-dropped', 'mean_abs_diff_m': round(float(diff.mean()), 1),
                      'max_abs_diff_m': float(diff.max())})
        el = el[:, :360]
    # Spikes, in every row except the poles (which are replaced below).
    rows = el.shape[0]
    for (i, j) in np.argwhere(el[1:rows - (1 if rows == HEIGHT else 0)] > MAX_ELEVATION) + [1, 0]:
        nb = [el[ii, jj % WIDTH] for ii in (i - 1, i, i + 1) for jj in (j - 1, j, j + 1)
              if 0 < ii < rows - 1 and (ii, jj % WIDTH) != (i, j) and el[ii, jj % WIDTH] <= MAX_ELEVATION]
        old = float(el[i, j])
        el[i, j] = float(np.median(nb))
        notes.append({'fix': 'spike-replaced', 'lat': int(90 - i), 'lon': int(j - 180), 'source_m': old, 'value_m': float(el[i, j])})
    if h == 180:
        el = np.vstack([el, el[-1:, :]])
        notes.append({'fix': 'south-pole-row-added', 'from': '89S row'})
    for row, name in ((0, 'north'), (HEIGHT - 1, 'south')):
        med = float(np.median(el[row]))
        changed = int((el[row] != med).sum())
        if changed:
            notes.append({'fix': f'{name}-pole-row-set-to-median', 'value_m': med, 'nodes_changed': changed,
                          'source_min_m': float(el[row].min()), 'source_max_m': float(el[row].max())})
        el[row] = med
    return np.rint(el).astype(np.int16), notes


def partition(polygons, rotations, age):
    part = pygplates.PlatePartitioner(polygons, rotations, float(age))
    plates = np.zeros((HEIGHT, WIDTH), dtype=np.uint16)
    for i in range(HEIGHT):
        lat = 90.0 - i
        cols = [0] if i in (0, HEIGHT - 1) else range(WIDTH)
        for j in cols:
            r = part.partition_point(pygplates.PointOnSphere(lat, j - 180.0))
            if r is not None:
                plates[i, j] = r.get_feature().get_reconstruction_plate_id()
        if i in (0, HEIGHT - 1):
            plates[i, :] = plates[i, 0]
    return plates


def fields(req):
    out = req['out']
    os.makedirs(os.path.join(out, 'elev'), exist_ok=True)
    os.makedirs(os.path.join(out, 'plate'), exist_ok=True)
    rotations = pygplates.RotationModel(req['rotations'])
    polygons = pygplates.FeatureCollection(req['polygons'])
    pf = pq.ParquetFile(req['paleodem'])
    meta = json.loads(pf.metadata.metadata[b'paleodem'])
    row_groups = meta['rowGroups']
    ages = [rg['ageMa'] for rg in row_groups if req['minAgeMa'] <= rg['ageMa'] <= req['maxAgeMa']]
    snapshots = []
    for index, rg in enumerate(row_groups):
        age = rg['ageMa']
        if age not in ages:
            continue
        elev, notes = load_snapshot(pf, index, rg)
        plates = partition(polygons, rotations, age)
        land = elev > 0
        deep = elev < -3000
        inside = plates > 0
        diag = {
            'land_fraction': round(float(land.mean()), 6),
            'land_inside_polygons': round(float((land & inside).sum() / max(1, land.sum())), 6),
            'deep_ocean_inside_polygons': round(float((deep & inside).sum() / max(1, deep.sum())), 6),
            'nodes_on_plates': round(float(inside.mean()), 6),
        }
        elev.astype('<i2').tofile(os.path.join(out, 'elev', f'{age}.i16'))
        plates.astype('<u2').tofile(os.path.join(out, 'plate', f'{age}.u16'))
        snapshots.append({'ageMa': age, 'sourceFile': rg['sourceFile'], 'sourceGrid': [rg['width'], rg['height']],
                          'min_m': int(elev.min()), 'max_m': int(elev.max()), 'corrections': notes,
                          'alignment': diag, 'plates': sorted(int(p) for p in np.unique(plates) if p)})
        print(f'  {age:3d} Ma: {len(notes)} corrections, land inside plate polygons {diag["land_inside_polygons"]:.3f}', flush=True)
    doc = {
        'format': 'lightworld-field-import@1',
        'grid': {'width': WIDTH, 'height': HEIGHT, 'lon0': -180, 'lat0': 90, 'step': 1,
                 'order': 'row-major from (90N, 180W), longitude fastest'},
        'arrays': {'elev': 'int16 little-endian metres, elev/<age>.i16', 'plate': 'uint16 little-endian plate id, plate/<age>.u16'},
        'pygplates': pygplates.__version__,
        'snapshots': snapshots,
    }
    with open(os.path.join(out, 'meta.json'), 'w') as f:
        json.dump(doc, f, indent=1, sort_keys=True)
        f.write('\n')


def blocks(req):
    out = req['out']
    os.makedirs(os.path.join(out, 'plate'), exist_ok=True)
    rotations = pygplates.RotationModel(req['rotations'])
    polygons = list(pygplates.FeatureCollection(req['polygons']))
    snapshots = []
    for age in req['agesMa']:
        alive = [f for f in polygons if f.is_valid_at_time(age)]
        placed = [f for f in alive if rotations.get_rotation(float(age), f.get_reconstruction_plate_id(), anchor_plate_id=0,
                                                             use_identity_for_missing_plate_ids=False) is not None]
        plates = partition(placed, rotations, age)
        inside = plates > 0
        plates.astype('<u2').tofile(os.path.join(out, 'plate', f'{age}.u16'))
        snapshots.append({'ageMa': age, 'polygons': len(placed), 'polygons_without_rotation': len(alive) - len(placed),
                          'nodes_on_plates': round(float(inside.mean()), 6), 'plates': sorted(int(p) for p in np.unique(plates) if p)})
        print(f'  {age:4d} Ma: {len(placed)} polygons ({len(alive) - len(placed)} without a rotation), nodes on plates {inside.mean():.3f}', flush=True)
    doc = {
        'format': 'lightworld-blocks-import@1',
        'grid': {'width': WIDTH, 'height': HEIGHT, 'lon0': -180, 'lat0': 90, 'step': 1,
                 'order': 'row-major from (90N, 180W), longitude fastest'},
        'arrays': {'plate': 'uint16 little-endian plate id, plate/<age>.u16'},
        'pygplates': pygplates.__version__,
        'snapshots': snapshots,
    }
    with open(os.path.join(out, 'meta.json'), 'w') as f:
        json.dump(doc, f, indent=1, sort_keys=True)
        f.write('\n')


def points(req):
    rotations = pygplates.RotationModel(req['rotations'])
    polygons = pygplates.FeatureCollection(req['polygons'])
    part = pygplates.PlatePartitioner(polygons, rotations, 0.0)
    results = []
    for p in req['points']:
        r = part.partition_point(pygplates.PointOnSphere(p['lat'], p['lon']))
        if r is None:
            results.append({'id': p['id'], 'plate': None})
            continue
        feature = r.get_feature()
        begin, end = feature.get_valid_time()
        results.append({
            'id': p['id'],
            'plate': feature.get_reconstruction_plate_id(),
            'polygonValidFromMa': None if begin == float('inf') else begin,
            'existsAt': {str(a): bool(feature.is_valid_at_time(a)) for a in p.get('agesMa', [])},
        })
    json.dump({'pygplates': pygplates.__version__, 'points': results}, sys.stdout, indent=1, sort_keys=True)
    sys.stdout.write('\n')


if __name__ == '__main__':
    command, request_path = sys.argv[1], sys.argv[2]
    with open(request_path) as f:
        request = json.load(f)
    {'fields': fields, 'blocks': blocks, 'points': points}[command](request)
