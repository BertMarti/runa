//go:build windows

package tty

import "os"

func openTTY() (in, out *os.File, err error) {
	in, err = os.OpenFile("CONIN$", os.O_RDWR, 0)
	if err != nil {
		return nil, nil, err
	}
	out, err = os.OpenFile("CONOUT$", os.O_WRONLY, 0)
	if err != nil {
		_ = in.Close()
		return nil, nil, err
	}
	return in, out, nil
}

func closeTTY(in, out *os.File) {
	_ = in.Close()
	_ = out.Close()
}
