# Licenças de terceiros

Levantamento das dependências de **produção** (`npm ls --omit=dev --all`), feito em 26/10/2026. Refazer ao atualizar dependências.

| Licença | Pacotes | Observação |
|---|---|---|
| MIT, ISC, BSD-2/3, Apache-2.0, 0BSD, MIT-0, Unlicense, CC0 | 225 | Permissivas: uso comercial livre; manter os avisos de copyright se o código for distribuído |
| LGPL-3.0-or-later | `@img/sharp-libvips-*` (biblioteca libvips, usada pelo `sharp`) | Biblioteca separada, sem modificação. Num SaaS (o código não é distribuído) não há obrigação extra. Se a imagem Docker ou o pacote for **distribuído** a terceiros, incluir o aviso da LGPL e o acesso ao código-fonte da libvips |
| MPL-2.0 | `lightningcss` | Só no build (Tailwind). Copyleft por arquivo; sem modificação, nada a fazer |
| CC-BY-4.0 | `caniuse-lite` | Dados de compatibilidade usados no build. Atribuição exigida se os dados forem redistribuídos |

Nenhuma dependência GPL ou AGPL.

O próprio projeto é **proprietário** (`"license": "UNLICENSED"` no `package.json`).

Ativos visuais: ícones em SVG desenhados no próprio projeto (`src/components/icons.tsx`); ícone do site gerado em código (`src/app/icon.tsx`); fontes do sistema operacional (nenhum arquivo de fonte é distribuído).
