"""Generate the gross payroll dataset from downloaded official workbooks."""
import json
import re
import sys
import unicodedata
from decimal import Decimal
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = 'https://www.aracaju.se.leg.br/transparencia/gestao-de-pessoas/Folha%20de%20Pagamento'
MONTHS = 'Janeiro Fevereiro Março Abril Maio Junho Julho Agosto Setembro Outubro Novembro Dezembro'.split()
# Full names confirmed in the official payroll and the Câmara profiles or SAPL authorship.
NAMES = {
    '1': 'Alecsandro de Melo', '2': 'Anderson Santos da Silva', '3': 'José Américo dos Santos Silva',
    '4': 'Aldeilson Soares dos Santos', '5': 'Breno Viana de Mendonça', '6': 'Camilo Feitosa Daniel',
    '7': 'Elber Andrade Batalha de Goes', '8': 'Fábio Meireles de Oliveira', '9': 'José Iran Barbosa Filho',
    '10': 'Isac de Oliveira Silveira', '11': 'José Joaquim Santos Nascimento', '12': 'Levi Santos de Oliveira Filho',
    '13': 'Lúcio Flávio Miranda da Rocha', '14': 'Maurício Santos Costa', '15': 'Milton Dantas de Farias Junior',
    '16': 'Moana Rollemberg Marinho Valadares', '17': 'Vitor Diego Lima Fortunato',
    '18': 'Sonia Meire Santos Azevedo de Jesus', '19': 'Ricardo Vasconcelos Silva', '20': 'Rodrigo Fontes Almeida',
    '21': 'José Sávio Gois Silva', '22': 'Regina Selma França Cruz', '23': 'Byron Virgilio dos Santos Silva',
    '24': 'Alexsandro da Conceição', '25': 'Thannata Stefany Aragão Oliveira', '26': 'Vinicius Porto Menezes',
    '27': 'Josenito Vitale de Jesus', '29': 'Marcel Vinícius Cunha Azevêdo', '30': 'Avilé Campos Dantas',
}


def normalize(value):
    return ''.join(char for char in unicodedata.normalize('NFD', ' '.join(value.casefold().split()))
                   if not unicodedata.combining(char))


def load_payroll(path):
    match = re.fullmatch(r'(202[56])-(\d{1,2})\.xlsx', path.name)
    if not match or not 1 <= int(match[2]) <= 12:
        raise ValueError(f'Nome de arquivo inválido: {path.name}')
    year, month = int(match[1]), int(match[2])
    label = MONTHS[month - 1]
    names = {normalize(name): id for id, name in NAMES.items()}
    salaries = {}
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        rows = iter(workbook.worksheets[0].values)
        intro = [next(rows) for _ in range(4)]
        if not any(f'{label}/{year}' in str(cell) for row in intro for cell in row):
            raise ValueError(f'Competência divergente em {path.name}')
        headers = list(next(rows))
        name_col, job_col, gross_col = [headers.index(key) for key in ('Nome', 'Cargo', 'Valor bruto')]
        sheet_col = headers.index('Folha') if 'Folha' in headers else None
        for row in rows:
            if normalize(str(row[job_col])) not in ('vereador', 'vereadora'):
                continue
            if sheet_col is not None and normalize(str(row[sheet_col])) != 'mensal':
                continue
            person = names.get(normalize(str(row[name_col])))
            if person is None:
                continue
            gross = Decimal(str(row[gross_col])) * 100
            if not gross.is_finite() or gross < 0 or gross != gross.to_integral_value() or person in salaries:
                raise ValueError(f'Valor bruto inválido ou duplicado em {path.name}')
            salaries[person] = int(gross)
    finally:
        workbook.close()
    if not salaries:
        raise ValueError(f'Sem registros correspondentes em {path.name}')
    month_slug = '02' if (year, month) == (2025, 2) else str(month)
    return {'id': f'{year}-{month:02}', 'year': year, 'label': f'{label} de {year}',
            'source': f'{BASE_URL}/{year}/folha-de-pagamento-{month_slug}-{year}.xlsx/view',
            'grossCents': salaries}


def main():
    reports = sorted((load_payroll(Path(name)) for name in sys.argv[1:]), key=lambda item: item['id'], reverse=True)
    if not reports or len({r['id'] for r in reports}) != len(reports):
        raise ValueError('Forneça uma planilha oficial para cada competência')
    (ROOT / 'dist/payroll.js').write_text(
        'export const payroll = ' + json.dumps(reports, ensure_ascii=False, indent=2) + ';\n')


if __name__ == '__main__':
    main()
