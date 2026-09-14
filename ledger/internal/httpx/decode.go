package httpx

import (
	"encoding/json"
	"net/http"

	"github.com/go-playground/validator/v10"
)

var validate = validator.New()

func DecodeAndValidate[T any](r *http.Request) (T, error) {
	var v T

	if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
		return v, err
	}

	validationErr := validate.Struct(v)

	if validationErr != nil {
		return v, validationErr
	}

	return v, validationErr
}
