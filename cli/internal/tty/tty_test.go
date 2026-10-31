package tty

import "testing"

func TestForDisplay(t *testing.T) {
	cases := map[string]struct {
		out     string
		changed bool
	}{
		"hola\nmundo\t!":     {"hola\nmundo\t!", false},
		"línea\r\nsiguiente": {"línea\r\nsiguiente", false},
		"\x1b[2Jborra":       {"�[2Jborra", true},
		"tapa\rfin":          {"tapa�fin", true},
		"\u009b31m":          {"�31m", true},
		"factura‮fdp.exe":    {"factura�fdp.exe", true},
		"ñandú 😀  ":          {"ñandú 😀  ", false},
		"\x00\x07\x7f":       {"���", true},
	}
	for in, want := range cases {
		out, changed := ForDisplay(in)
		if out != want.out || changed != want.changed {
			t.Errorf("ForDisplay(%q) = %q %v", in, out, changed)
		}
	}
}
