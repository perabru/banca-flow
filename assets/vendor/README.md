# SheetJS Community Edition

Vendored official standalone full build, version **0.20.3**.

- Source: https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
- Installation and vendoring: https://docs.sheetjs.com/docs/getting-started/installation/standalone/
- License: `SheetJS-LICENSE.txt` (Apache-2.0).

The application loads this local file; importing a roster does not send the spreadsheet to a parsing service. Macros are not requested or executed. Formula cells in the selected sheet are rejected; use value-only cells. Update this pinned copy only after reviewing upstream release and security notes and rerunning `tests/import.test.cjs`.
