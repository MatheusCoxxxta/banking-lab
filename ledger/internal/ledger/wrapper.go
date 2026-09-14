package ledger

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"

	"github.com/go-playground/validator/v10"
)

type appHandler func(w http.ResponseWriter, r *http.Request) error

func ErrorWrapper(h appHandler) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		err := h(w, r)
		if err == nil {
			return
		}

		var vErr validator.ValidationErrors
		var syntaxErr *json.SyntaxError
		var unmarshalErr *json.UnmarshalTypeError

		status := http.StatusInternalServerError

		switch {
		case errors.As(err, &vErr):
			status = http.StatusUnprocessableEntity
		case errors.As(err, &syntaxErr), errors.As(err, &unmarshalErr):
			status = http.StatusBadRequest
		case errors.Is(err, SenderNotFoundError), errors.Is(err, ReceiverNotFoundError):
			status = http.StatusNotFound
		case errors.Is(err, InsufficientBalanceError):
			status = http.StatusUnprocessableEntity
		default:
			log.Printf("unhandled error on %s %s: %s", r.Method, r.URL.Path, err)
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
	}
}
