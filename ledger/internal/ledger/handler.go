package ledger

import (
	"context"
	"net/http"

	"github.com/MatheusCoxxxta/banking-lab/ledger/internal/httpx"
)

func (s *Store) HandleTransferMoney(w http.ResponseWriter, r *http.Request) error {
	data, err := httpx.DecodeAndValidate[SendMoneyDto](r)

	if err != nil {
		return err
	}

	ctx := context.Background()

	if err := s.transferMoneyUsecase(ctx, data); err != nil {
		return err
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	return nil
}
