"""Write reference total rotations computed by pyGPlates, for testing core/rotation-model.ts.

    .venv/bin/python tools/world/importers/golden_rotations.py <PALEOMAP_PlateModel.rot> <out.json>

Each case is [plate, age_ma, w, x, y, z]: the unit quaternion of the total rotation of
`plate` relative to plate 0 at `age_ma`, with w >= 0.
"""
import hashlib
import json
import math
import sys

import pygplates

AGES = [0.0, 2.5, 47.9, 66.0, 71.5, 145.3, 245.0, 280.0, 300.0, 306.0, 404.0, 425.0, 540.0]


def quaternion(rotation):
    if rotation.represents_identity_rotation():
        return [1.0, 0.0, 0.0, 0.0]
    lat, lon, angle = rotation.get_lat_lon_euler_pole_and_angle_degrees()
    la, lo, h = math.radians(lat), math.radians(lon), math.radians(angle) / 2
    axis = (math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la))
    q = [math.cos(h)] + [math.sin(h) * a for a in axis]
    if q[0] < 0:
        q = [-c for c in q]
    return q


def main(rot_path, out_path):
    model = pygplates.RotationModel(rot_path)
    plates = sorted({int(line.split()[0]) for line in open(rot_path, encoding='latin-1') if line.strip()} - {999})
    cases = []
    for plate in plates:
        for age in AGES:
            q = quaternion(model.get_rotation(age, plate, anchor_plate_id=0))
            cases.append([plate, age] + [round(c, 12) for c in q])
    with open(rot_path, 'rb') as f:
        sha = hashlib.sha256(f.read()).hexdigest()
    doc = {
        'generator': 'tools/world/importers/golden_rotations.py',
        'pygplates': pygplates.__version__,
        'rotationFileSha256': sha,
        'anchor': 0,
        'cases': cases,
    }
    with open(out_path, 'w') as f:
        json.dump(doc, f, separators=(',', ':'))
        f.write('\n')
    print(f'{len(cases)} cases from {len(plates)} plates -> {out_path}')


if __name__ == '__main__':
    main(*sys.argv[1:3])
