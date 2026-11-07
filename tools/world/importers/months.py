"""Read a climate model's monthly temperature and precipitation from a NetCDF-4 (HDF5) file into WikiWorldModel's import
format, which the build reads without a library for HDF5.

    python months.py <request.json>

The request names the file, the output directory, and the file's variables: `temperature` and `precipitation`, each of
dimensions (time, month, latitude, longitude), and `time`, `latitude` and `longitude`. For each time slice i, in the
file's order, it writes:

  land/<i>.u32   the cells with a value, as row * longitudes + column on the file's own grid
  t/<i>.i16      their twelve months of temperature, in tenths of a degree, month by month for each cell
  p/<i>.u16      their twelve months of precipitation, in tenths of a millimetre, the same way

and meta.json, with the grid's latitudes and longitudes, the times and their unit, and how many cells each slice has.
A cell has a value when all twelve months of both variables have one. Nothing is regridded, averaged or corrected:
the build reads the months themselves.
"""
import json
import os
import sys

import h5py
import numpy as np


def text(v):
    return v.decode() if isinstance(v, bytes) else str(v)


def main(req):
    out = req['out']
    for d in ('land', 't', 'p'):
        os.makedirs(os.path.join(out, d), exist_ok=True)
    with h5py.File(req['file'], 'r') as f:
        temp = f[req['temperature']]
        prec = f[req['precipitation']]
        times = f[req['time']][:]
        lat = f[req['latitude']][:]
        lon = f[req['longitude']][:]
        n, months, nlat, nlon = temp.shape
        if prec.shape != temp.shape or months != 12 or (nlat, nlon) != (len(lat), len(lon)) or n != len(times):
            raise ValueError(f'unexpected shapes: temperature {temp.shape}, precipitation {prec.shape}')
        units = {'temperature': text(temp.attrs.get('units', '')), 'precipitation': text(prec.attrs.get('units', '')), 'time': text(f[req['time']].attrs.get('units', ''))}
        slices = []
        # Read as the file is chunked, several slices at a time.
        block = (temp.chunks or (1,))[0]
        for start in range(0, n, block):
            t_block = temp[start:start + block]
            p_block = prec[start:start + block]
            for k in range(t_block.shape[0]):
                i = start + k
                t = t_block[k].reshape(12, -1)
                p = p_block[k].reshape(12, -1)
                ok = np.all(np.isfinite(t), axis=0) & np.all(np.isfinite(p), axis=0)
                cells = np.nonzero(ok)[0].astype('<u4')
                tt = np.rint(t[:, cells].T * 10)
                pp = np.rint(np.maximum(p[:, cells].T, 0) * 10)
                if tt.size and (tt.min() < -32768 or tt.max() > 32767 or pp.max() > 65535):
                    raise ValueError(f'slice {i}: a value does not fit its integer')
                cells.tofile(os.path.join(out, 'land', f'{i}.u32'))
                tt.astype('<i2').tofile(os.path.join(out, 't', f'{i}.i16'))
                pp.astype('<u2').tofile(os.path.join(out, 'p', f'{i}.u16'))
                slices.append({'index': i, 'time': int(times[i]), 'cells': int(cells.size),
                               'min_t': round(float(tt.min()) / 10, 1) if tt.size else None,
                               'max_t': round(float(tt.max()) / 10, 1) if tt.size else None,
                               'max_p': round(float(pp.max()) / 10, 1) if pp.size else None})
                print(f'  slice {i:3d} ({int(times[i])} {units["time"]}): {cells.size} cells', flush=True)
    doc = {
        'format': 'lightworld-months-import@1',
        'grid': {'latitudes': [float(x) for x in lat], 'longitudes': [float(x) for x in lon], 'order': 'row-major, latitude by latitude as the file has them'},
        'arrays': {'land': 'uint32 little-endian cell, land/<i>.u32', 't': 'int16 little-endian tenths of the unit, 12 per cell, t/<i>.i16', 'p': 'uint16 little-endian tenths of the unit, 12 per cell, p/<i>.u16'},
        'units': units,
        'h5py': h5py.__version__,
        'slices': slices,
    }
    with open(os.path.join(out, 'meta.json'), 'w') as fh:
        json.dump(doc, fh, indent=1, sort_keys=True)
        fh.write('\n')


if __name__ == '__main__':
    with open(sys.argv[1]) as fh:
        main(json.load(fh))
