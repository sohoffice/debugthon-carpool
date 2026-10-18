package main

import (
	"log"
	"os"

	"github.com/sohoffice/debugthon-carpool/backend/internal/server"
)

func main() {
	addr := ":8080"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}
	if err := server.NewRouter().Run(addr); err != nil {
		log.Fatal(err)
	}
}
