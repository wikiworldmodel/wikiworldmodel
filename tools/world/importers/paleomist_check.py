#!/usr/bin/env python3
"""Set PaleoMIST 1.0's ice margin against other lines: its own margin files, NADI-1 and DATED-1.

These are the checks behind the field's margin_m and its uncertainty (world/fields/earth/ice-sheets.yaml
and docs/RECORD-SETS.md). The build runs none of this and imports nothing from NADI-1 or DATED-1: their
lines are read here to measure against, and thrown away. With numpy, h5py, pillow and pyproj, none of
which the build needs:

    python tools/world/importers/paleomist_check.py <a directory for the downloads>

The two grids and PaleoMIST's margin files are read out of its archive by range requests. NADI-1 and
DATED-1's time slices are downloaded whole, about 66 MB.
"""
import os
import struct
import subprocess
import sys
import zipfile

import h5py
import numpy as np
import pyproj
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from paleomist_snapshot import MEMBERS, USER_AGENT, central_directory, read_member  # noqa: E402

NADI = "https://zenodo.org/api/records/8161764/files/NADI-1%20shapefiles%20Dalton%20et%20al.%20QSR.zip/content"
DATED = "https://store.pangaea.de/Publications/HughesA-etal_2015/DATED-1_TimeSlices_shp.zip"
# Cells of the raster the lines are drawn on, per degree; and the grid's nodes.
R = 10
W, H = 360 * R, 180 * R
LAT = np.arange(-90.0, 91.0)
LON = np.arange(-180.0, 180.0)
AREA = np.cos(np.radians(LAT))[:, None] * 111.19**2
THRESHOLDS = [1, 10, 25, 50, 75, 100, 150, 200, 300, 500]


def download(url, path):
    if not os.path.exists(path):
        subprocess.run(["curl", "-sS", "-L", "-A", USER_AGENT, "--max-time", "900", "-o", path, url], check=True)
    return path


def fill(rings):
    """Rings of (lon, lat), outer ones then holes (kind 'P' or 'H'), onto the raster."""
    im = Image.new("1", (W, H), 0)
    draw = ImageDraw.Draw(im)
    for want in ("P", "H"):
        for kind, ring in rings:
            if kind != want or len(ring) < 3:
                continue
            lon = np.degrees(np.unwrap(np.radians(ring[:, 0])))
            shifts = [0] + ([360] if lon.min() < -180 else []) + ([-360] if lon.max() > 180 else [])
            for s in shifts:
                draw.polygon([((x + s + 180) * R, (90 - y) * R) for x, y in zip(lon, ring[:, 1])], fill=1 if want == "P" else 0)
    return np.array(im, dtype=np.uint8)


def to_nodes(raster):
    """Which nodes have half or more of the degree around them inside what was drawn."""
    integral = np.zeros((H + 1, 2 * W + 1))
    integral[1:, 1:] = np.concatenate([raster, raster], 1).astype(float).cumsum(0).cumsum(1)
    out = np.zeros((len(LAT), len(LON)), bool)
    for j, la in enumerate(LAT):
        y0, y1 = max(0, int(round((90 - (la + 0.5)) * R))), min(H, int(round((90 - (la - 0.5)) * R)))
        if y1 <= y0:
            continue
        for i, lo in enumerate(LON):
            x0 = int(round((lo - 0.5 + 180) * R)) % W
            x1 = x0 + R
            out[j, i] = (integral[y1, x1] - integral[y0, x1] - integral[y1, x0] + integral[y0, x0]) / ((y1 - y0) * R) >= 0.5
    return out


def shapefile_rings(data, project=None):
    """The rings of a shapefile's polygons. In the format outer rings run clockwise, and holes the other way."""
    p, rings = 100, []
    while p < len(data):
        _, length = struct.unpack(">II", data[p : p + 8])
        record = data[p + 8 : p + 8 + length * 2]
        p += 8 + length * 2
        if struct.unpack("<i", record[:4])[0] not in (5, 15, 25):
            continue
        parts_n, points_n = struct.unpack("<ii", record[36:44])
        parts = struct.unpack(f"<{parts_n}i", record[44 : 44 + 4 * parts_n])
        xy = np.frombuffer(record[44 + 4 * parts_n : 44 + 4 * parts_n + 16 * points_n], dtype="<f8").reshape(-1, 2)
        for i, start in enumerate(parts):
            ring = xy[start : parts[i + 1] if i + 1 < parts_n else points_n]
            clockwise = np.sum(ring[:-1, 0] * ring[1:, 1] - ring[1:, 0] * ring[:-1, 1]) < 0
            if project:
                ring = project(ring)
            rings.append(("P" if clockwise else "H", ring))
    return rings


def margin_rings(path):
    """The polygons of a file in the GMT text format."""
    rings, current, kind = [], None, None
    for line in open(path, errors="replace"):
        if line.startswith("# @P") or line.startswith("# @H"):
            current, kind = [], line[3]
            rings.append((kind, current))
        elif line.startswith(">"):
            current = None
        elif not line.startswith("#") and current is not None:
            x = line.split()
            if len(x) >= 2:
                current.append((float(x[0]), float(x[1])))
    return [(k, np.array(c)) for k, c in rings]


def edge(mask):
    e = np.zeros_like(mask)
    e[:-1, :] |= mask[:-1, :] != mask[1:, :]
    e[:, :-1] |= mask[:, :-1] != mask[:, 1:]
    return e


def box(la0, la1, lo0, lo1):
    b = np.zeros((len(LAT), len(LON)), bool)
    b[np.ix_((LAT >= la0) & (LAT <= la1), (LON >= lo0) & (LON <= lo1))] = True
    return b


def against(name, ka, within, ours, best, low, high):
    a, b = ours & within, best & within
    area = lambda m: (m * AREA).sum() / 1e6
    iou = area(a & b) / area(a | b)
    # The margin itself, not where the box cuts it.
    margin = edge(ours) & within
    band = (margin & (high | edge(high)) & ~(low & ~edge(low))).sum() / max(1, margin.sum())
    print(f"{name} {ka:5.1f} ka: {area(a):.1f} million km² here, {area(b):.1f} there, between {area(low & within):.1f} and {area(high & within):.1f}; intersection over union {iou:.2f}; {band * 100:.0f}% of the margin's nodes inside its band")


def main():
    work = sys.argv[1]
    os.makedirs(work, exist_ok=True)
    _, members = central_directory()

    def member(path):
        local = os.path.join(work, path.replace("/", "_"))
        if not os.path.exists(local):
            open(local, "wb").write(read_member(members[path]))
        return local

    with h5py.File(member(MEMBERS["ice_thickness_maximal"]), "r") as f:
        time = list(f["time"][()])
        maximal = np.nan_to_num(f["ice_thickness"][()])[:, :, :-1]
    with h5py.File(member(MEMBERS["ice_thickness_minimal"]), "r") as f:
        minimal = np.nan_to_num(f["ice_thickness"][()])[:, :, :-1]
    frame = lambda grid, ka: grid[time.index(-ka * 1000.0)]

    print("Its own margin files, north of 60°S: which thickness on the 1° grid follows them best")
    north = box(-60, 90, -180, 180)
    for ka, region, grid in [(20, "North_America", maximal), (60, "North_America", maximal), (42.5, "North_America", minimal), (42.5, "North_America_a1", maximal), (12.5, "North_America", maximal)]:
        age = int(ka * 1000)
        rings = [r for reg in (region, "Eurasia", "Patagonia") for r in margin_rings(member(f"ice_reconstruction/margins/{reg}/{age}.gmt"))]
        best = to_nodes(fill(rings)) & north
        row = {}
        for th in THRESHOLDS:
            a = (frame(grid, ka) > th) & north
            row[th] = ((a & best) * AREA).sum() / ((a | best) * AREA).sum()
        print(f"  {ka:5.1f} ka {region:17s} " + " ".join(f"{th}:{row[th]:.3f}" for th in THRESHOLDS))

    ours = lambda ka: frame(maximal, ka) > 100
    print("NADI-1 (Dalton et al. 2023), south of 72°N and west of 55°W, as Greenland and the Innuitian ice are not in it")
    nadi = zipfile.ZipFile(download(NADI, os.path.join(work, "nadi-1.zip")))
    shp = lambda ka, kind: [n for n in nadi.namelist() if n.endswith(".shp") and n.split("/")[-1].startswith(f"{ka:g}ka_cal_{kind}_NADI-1")][0]
    for ka in (25, 22.5, 20, 17.5, 15, 12.5, 10):
        lines = [to_nodes(fill(shapefile_rings(nadi.read(shp(ka, k))))) for k in ("OPTIMAL", "MIN", "MAX")]
        against("NADI-1", ka, box(25, 72, -170, -55), ours(ka), *lines)

    print("DATED-1 (Hughes et al. 2016), north of 45°N and between 12°W and 110°E. PaleoMIST took its margins from it, so this tests little")
    dated = zipfile.ZipFile(download(DATED, os.path.join(work, "dated-1.zip")))
    # Its slices are on a Lambert azimuthal equal-area grid centred on the pole, in metres.
    to_lonlat = pyproj.Transformer.from_crs("+proj=laea +lat_0=90 +lon_0=0 +datum=WGS84 +units=m", "EPSG:4326", always_xy=True)
    project = lambda r: np.stack(to_lonlat.transform(r[:, 0], r[:, 1]), 1)
    for ka in (25, 20, 15):
        lines = [to_nodes(fill(shapefile_rings(dated.read(f"DATED1 TimeSlices shp/TS{ka}_{k}.shp"), project))) for k in ("mc", "min", "max")]
        against("DATED-1", ka, box(45, 85, -12, 110), ours(ka), *lines)


if __name__ == "__main__":
    main()
