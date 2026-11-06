#!/usr/bin/env python3
"""Make world/snapshots/paleomist-1.0-ice-thickness.zip from the PaleoMIST 1.0 archive on PANGAEA.

The archive is 3.7 GB and the world needs one variable of two of its files, so each file is read
out of the zip by range requests and checked against the CRC the zip gives for it. Those files are
NetCDF-4, which the build's reader does not read; what is kept is their `ice_thickness`, to the
metre, in a classic NetCDF file that the build reads and any NetCDF tool can open.

The build does not run this: it reads the snapshot, pinned by checksum in world/manifest.yaml. To
make it again, with numpy and h5py, which the build does not need:

    python -I tools/world/importers/paleomist_snapshot.py world/snapshots/paleomist-1.0-ice-thickness.zip

It prints what the manifest records.
"""
import hashlib
import io
import json
import struct
import subprocess
import sys
import tempfile
import zipfile
import zlib

import h5py
import numpy as np

ARCHIVE = "https://hs.pangaea.de/Maps/Global_Ice_Sheets/Gowan_ice_reconstruction.zip"
USER_AGENT = "wikiworldmodel-research/0.1"
MEMBERS = {
    "ice_thickness_minimal": "ice_reconstruction/global_grid/reconstruction_1_degree.nc",
    "ice_thickness_maximal": "ice_reconstruction/global_grid/reconstruction_a1_1_degree.nc",
}
INNER = "paleomist-1.0-ice-thickness-1deg.nc"


def get_range(start, end):
    out = subprocess.run(
        ["curl", "-sS", "-L", "-A", USER_AGENT, "--max-time", "900", "-r", f"{start}-{end}", ARCHIVE],
        capture_output=True,
        check=True,
    ).stdout
    if len(out) != end - start + 1:
        raise RuntimeError(f"asked for {end - start + 1} bytes at {start}, got {len(out)}")
    return out


def central_directory():
    """Every member of the archive: its method, CRC, sizes and offset."""
    head = subprocess.run(["curl", "-sSI", "-L", "-A", USER_AGENT, "--max-time", "60", ARCHIVE], capture_output=True, check=True, text=True).stdout
    size = int([x for x in head.splitlines() if x.lower().startswith("content-length")][-1].split(":")[1])
    tail = get_range(size - 70000, size - 1)
    at = tail.rfind(b"PK\x05\x06")
    length, offset = struct.unpack("<II", tail[at + 12 : at + 20])
    cd = get_range(offset, offset + length - 1)
    members = {}
    p = 0
    while cd[p : p + 4] == b"PK\x01\x02":
        method, crc, csize, usize = struct.unpack("<HxxxxIII", cd[p + 10 : p + 28])
        nl, el, cl = struct.unpack("<HHH", cd[p + 28 : p + 34])
        off = struct.unpack("<I", cd[p + 42 : p + 46])[0]
        members[cd[p + 46 : p + 46 + nl].decode()] = {"method": method, "crc": crc, "csize": csize, "usize": usize, "offset": off}
        p += 46 + nl + el + cl
    return size, members


def read_member(m):
    nl, el = struct.unpack("<HH", get_range(m["offset"] + 26, m["offset"] + 29))
    start = m["offset"] + 30 + nl + el
    raw = get_range(start, start + m["csize"] - 1)
    data = zlib.decompress(raw, -15) if m["method"] == 8 else raw
    if zlib.crc32(data) & 0xFFFFFFFF != m["crc"] or len(data) != m["usize"]:
        raise RuntimeError("a member does not match its CRC")
    return data


def write_cdf2(dims, attrs, variables):
    """A classic NetCDF file (the 64-bit offset format), fixed dimensions only, values big-endian."""
    NC_DIMENSION, NC_VARIABLE, NC_ATTRIBUTE, NC_CHAR, NC_SHORT, NC_DOUBLE = 10, 11, 12, 2, 3, 6
    pad = lambda b: b + b"\0" * (-len(b) % 4)
    name = lambda s: struct.pack(">I", len(s.encode())) + pad(s.encode())
    attributes = lambda a: (struct.pack(">II", NC_ATTRIBUTE, len(a)) + b"".join(name(k) + struct.pack(">II", NC_CHAR, len(v.encode())) + pad(v.encode()) for k, v in a.items())) if a else struct.pack(">II", 0, 0)
    ids = {d: i for i, (d, _) in enumerate(dims)}
    head = b"CDF\x02" + struct.pack(">I", 0)
    head += struct.pack(">II", NC_DIMENSION, len(dims)) + b"".join(name(d) + struct.pack(">I", n) for d, n in dims)
    head += attributes(attrs)
    types = {"f8": (NC_DOUBLE, ">f8"), "i2": (NC_SHORT, ">i2")}

    def var_section(begins):
        out = struct.pack(">II", NC_VARIABLE, len(variables))
        for (nm, vdims, kind, vattrs, values), begin in zip(variables, begins):
            data_len = len(pad(values.astype(types[kind][1]).tobytes()))
            out += name(nm) + struct.pack(">I", len(vdims)) + b"".join(struct.pack(">I", ids[d]) for d in vdims)
            out += attributes(vattrs) + struct.pack(">II", types[kind][0], data_len) + struct.pack(">Q", begin)
        return out

    begin = len(head) + len(var_section([0] * len(variables)))
    begins = []
    for _, _, kind, _, values in variables:
        begins.append(begin)
        begin += len(pad(values.astype(types[kind][1]).tobytes()))
    out = head + var_section(begins)
    return out + b"".join(pad(v[4].astype(types[v[2]][1]).tobytes()) for v in variables)


def main():
    target = sys.argv[1]
    size, members = central_directory()
    grids = {}
    made_from = []
    axes = None
    for var, member in MEMBERS.items():
        m = members[member]
        data = read_member(m)
        made_from.append({"member": member, "crc32": f"{m['crc']:08x}", "bytes": m["usize"], "sha256": hashlib.sha256(data).hexdigest()})
        with tempfile.NamedTemporaryFile(suffix=".nc") as tmp:
            tmp.write(data)
            tmp.flush()
            with h5py.File(tmp.name, "r") as f:
                got = (f["time"][()], f["lat"][()], f["lon"][()])
                if axes is not None and not all(np.array_equal(a, b) for a, b in zip(axes, got)):
                    raise RuntimeError("the two grids have different axes")
                axes = got
                thick = np.rint(np.nan_to_num(f["ice_thickness"][()]))
        if thick.min() < 0 or thick.max() > 32767:
            raise RuntimeError(f"{var}: thickness from {thick.min()} to {thick.max()}")
        grids[var] = thick.astype("i2")
    time, lat, lon = axes
    attrs = {
        "title": "PaleoMIST 1.0: grounded ice thickness, both North American scenarios, every 2500 years for 80,000 years, on a 1 degree grid",
        "source": "Gowan, E.J. (2019). Global ice sheet reconstruction for the past 80000 years. PANGAEA, https://doi.org/10.1594/PANGAEA.905800. CC BY 4.0.",
        "history": "The variable ice_thickness of each file named in made_from, rounded to the metre. Nothing else is changed: same axes, same order. By tools/world/importers/paleomist_snapshot.py.",
        "made_from": json.dumps({"archive": ARCHIVE, "archive_bytes": size, "members": made_from}, sort_keys=True),
    }
    time_attrs = {"long_name": "Time", "units": "years since 1950, as the source gives it"}
    thick_attrs = {"units": "m", "long_name": "grounded ice thickness"}
    variables = [
        ("time", ["time"], "f8", time_attrs, time),
        ("lat", ["lat"], "f8", {"units": "degrees_north"}, lat),
        ("lon", ["lon"], "f8", {"units": "degrees_east"}, lon),
        ("ice_thickness_maximal", ["time", "lat", "lon"], "i2", {**thick_attrs, "scenario": "maximal: ice over Hudson Bay throughout MIS 3 (the archive's a1 files)"}, grids["ice_thickness_maximal"]),
        ("ice_thickness_minimal", ["time", "lat", "lon"], "i2", {**thick_attrs, "scenario": "minimal: Hudson Bay ice free for a short time in MIS 3"}, grids["ice_thickness_minimal"]),
    ]
    nc = write_cdf2([("time", len(time)), ("lat", len(lat)), ("lon", len(lon))], attrs, variables)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        info = zipfile.ZipInfo(INNER, date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        z.writestr(info, nc, compresslevel=9)
    with open(target, "wb") as f:
        f.write(buf.getvalue())
    print(json.dumps({
        "file": target,
        "bytes": len(buf.getvalue()),
        "sha256": hashlib.sha256(buf.getvalue()).hexdigest(),
        "member": {"path": INNER, "bytes": len(nc), "sha256": hashlib.sha256(nc).hexdigest()},
        "made_from": made_from,
    }, indent=1))


if __name__ == "__main__":
    main()
