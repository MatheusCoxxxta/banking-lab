package api

import (
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
)

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	w.Header().Set("Content-Type", "application/json")

	json.NewEncoder(w).Encode(map[string]string{
		"now": time.Now().Format(time.RFC3339),
	})
}

func main() {
	PORT := os.Getenv("PORT")
	if PORT == "" {
		log.Println("PORT NOT SET BUT IT'S REQUIRED")
		return
	}

	log.Println("Starting server on :" + PORT)

	r := chi.NewRouter()

	r.Get("/health-check", handleHealth)
	r.Post("/send-money", handleSendMoney)

	log.Fatal(http.ListenAndServe(":"+PORT, r))
}
