#!/bin/bash
# Content AI - polecenia kont z konfiguracja uslugi (PROJEKT-TECHNICZNY 12.2).
#
#   sudo serwer/cli.sh lista
#   sudo serwer/cli.sh haslo marcin
#   sudo serwer/cli.sh --srodowisko /etc/contentai/srodowisko-test lista   # srodowisko testowe
#
# Laduje plik srodowiska uslugi (domyslnie /etc/contentai/srodowisko, czytelny tylko
# dla roota) i uruchamia serwer/uzytkownicy.js jako konto uslugi (domyslnie contentai).
# Dzieki temu CLI widzi te same katalogi danych i baze co usluga, a pliki bazy
# (contentai.sqlite-wal, -shm) nie powstaja jako root - plik roota z trybem 0600
# zablokowalby usludze zapis. uzytkownicy.js i tak odmawia pracy, gdy katalog danych
# nalezy do innego konta niz proces.
set -euo pipefail

KATALOG="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRODOWISKO="${CAI_SRODOWISKO:-/etc/contentai/srodowisko}"
KONTO="${CAI_KONTO_USLUGI:-contentai}"

if [ "${1:-}" = "--srodowisko" ]; then
  SRODOWISKO="${2:?podaj plik srodowiska po --srodowisko}"
  shift 2
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "Uruchom przez sudo: sudo $0 $*" >&2
  exit 1
fi
if [ ! -r "$SRODOWISKO" ]; then
  echo "Brak pliku srodowiska $SRODOWISKO (albo nie da sie go odczytac)." >&2
  exit 1
fi
if ! id "$KONTO" >/dev/null 2>&1; then
  echo "Nie ma konta uslugi $KONTO (CAI_KONTO_USLUGI)." >&2
  exit 1
fi
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "Nie znaleziono node w PATH." >&2
  exit 1
fi

# Zmienne z pliku srodowiska trafiaja do procesu CLI (set -a eksportuje kazde przypisanie).
set -a
# shellcheck disable=SC1090
. "$SRODOWISKO"
set +a

cd "$KATALOG/.."
exec sudo -E -u "$KONTO" -- "$NODE" --disable-warning=ExperimentalWarning "$KATALOG/uzytkownicy.js" "$@"
