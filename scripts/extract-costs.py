"""Extract factual cost tables from a resolved game client; no game code is executed."""
import hashlib
import json
import re
import sys
from pathlib import Path

source = Path(sys.argv[1]).read_bytes()
s = source.decode()

def table(method):
    body = s.split("['" + method + "']=function", 1)[1].split('default:', 1)[0]
    result = {}
    for cases, value in re.findall(r'((?:case 0x[0-9a-f]+:)+)return (0x[0-9a-f]+);', body):
        for key in re.findall(r'case (0x[0-9a-f]+):', cases):
            result[int(key, 16)] = int(value, 16)
    if not result:
        raise ValueError('Missing cost table: ' + method)
    return result

result = {
    'clientVersion': '6.3.5.0',
    'sha256': hashlib.sha256(source).hexdigest(),
    'development': table('_getRequiredDevkitNum'),
    'construction': table('_getRequiredBuildKitNum'),
    'blueprintDevelopmentExceptions': [503, 504],
    'gunMaterialByTarget': {546: 3, 591: 2, 592: 2, 694: 2, 987: 2, 666: 1, 986: 1},
    'arsenalMaterialByTarget': {1040: 5, 1071: 5, 743: 3, 748: 3, 749: 3, 744: 2, 745: 2, 1036: 2, 1061: 1},
}
Path(__file__).resolve().parents[1].joinpath('data/client-costs.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
