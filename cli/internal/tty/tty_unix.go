//go:build !windows

package tty

import "os"

func openTTY() (in, out *os.File, err error) {
	f, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err != nil {
		return nil, nil, err
	}
	return f, f, nil
}

func closeTTY(in, _ *os.File) { _ = in.Close() }
