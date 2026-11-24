"""Generate the attendance chart data from the Câmara's official workbooks."""
import io
import json
import unicodedata
from pathlib import Path
from urllib.request import urlopen

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'https://www.aracaju.se.leg.br/processo-legislativo/presenca-dos-parlamentares'
FILES = [
    ('2026-09', 'Setembro de 2026', 'presenca-setembro-2026.xlsx'),
    ('2026-consolidado', 'Consolidado 2026 (publicado em agosto)', 'presenca-agosto-2026.xlsx'),
    ('2026-07', 'Julho de 2026', 'presenca-julho-2026.xlsx'),
    ('2026-06', 'Junho de 2026', 'presenca-junho-2026.xlsx'),
    ('2026-05', 'Maio de 2026', 'presenca_maio_2026.xlsx'),
]
ALIASES = {
    'elber batalha filho': 'elber batalha',
    'pr. diego': 'pastor diego',
    'profª. sonia meire': 'professora sonia meire',
    'sgt. byron': 'sgt. byron estrelas do mar',
}


def name_key(value):
    return ''.join(c for c in unicodedata.normalize('NFD', value.casefold().strip())
                   if not unicodedata.combining(c))


def load_rows(content, people):
    sheet = load_workbook(io.BytesIO(content), read_only=True, data_only=True).active
    rows = iter(sheet.values)
    next(rows)
    next(rows)
    headers = next(rows)
    if headers != ('Parlamentar', 'Ano', 'Sessões', 'Presença', 'Falta', 'Aus. Justificada', 'Licenciado'):
        raise ValueError('Colunas inesperadas na planilha de frequência')
    attendance = {}
    for name, year, sessions, present, absent, justified, leave in rows:
        if name is None:
            continue
        key = name_key(name)
        person = people[ALIASES.get(key, key)]
        counts = list(map(int, (sessions, present, absent, justified, leave)))
        if int(year) != 2026 or person in attendance or min(counts) < 0 or counts[0] != sum(counts[1:]):
            raise ValueError(f'Frequência inconsistente para {name}')
        attendance[person] = {'sessions': counts[0], 'justified': counts[3], 'unjustified': counts[2]}
    if not attendance:
        raise ValueError('Planilha sem registros de frequência')
    return attendance


def main():
    data = (ROOT / 'dist/data.js').read_text().strip().removeprefix('export const catalog = ').removesuffix(';')
    people = {name_key(person['name']): person['id'] for person in json.loads(data)['people']}
    periods = []
    for key, label, filename in FILES:
        with urlopen(f'{SOURCE}/{filename}/at_download/file', timeout=20) as response:
            counts = load_rows(response.read(), people)
        periods.append({
            'id': key, 'label': label, 'year': 2026, 'source': f'{SOURCE}/{filename}/view',
            'sessions': max(row['sessions'] for row in counts.values()), 'counts': counts,
        })
    (ROOT / 'dist/attendance.js').write_text(
        'export const attendance = ' + json.dumps(periods, ensure_ascii=False, indent=2) + ';\n'
    )


if __name__ == '__main__':
    main()
