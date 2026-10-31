package app

import (
	"os"
	"testing"
)

// TestE2E repite los escenarios contra un servidor real de RUNA. Solo se ejecuta con RUNA_E2E_URL, p. ej.:
//
//	npm run build && PORT=8499 DATA_DIR=$(mktemp -d) RATE_LIMIT_CREATE=1000 RATE_LIMIT_OPEN=1000 npm start &
//	RUNA_E2E_URL=http://127.0.0.1:8499 go test ./internal/app -run TestE2E -v
//
// (Ver también scripts/cli-e2e.sh, que hace todo esto y además prueba la interoperabilidad con la web.)
func TestE2E(t *testing.T) {
	url := os.Getenv("RUNA_E2E_URL")
	if url == "" {
		t.Skip("define RUNA_E2E_URL para probar contra un servidor real")
	}
	for name, scenario := range scenarios {
		t.Run(name, func(t *testing.T) {
			scenario(&cli{t: t, server: url, dir: t.TempDir()})
		})
	}
}
