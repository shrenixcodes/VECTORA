package main

import (
	"fmt"
	"net/http"

	"example.com/orbit/tools/store"
)

func health(w http.ResponseWriter, r *http.Request) {
	fmt.Fprintln(w, "ok")
}

func main() {
	s := store.New()
	fmt.Println(store.Count(s))
	http.HandleFunc("/health", health)
}
