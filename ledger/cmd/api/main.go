package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"github.com/MatheusCoxxxta/banking-lab/ledger/internal/config"
	"github.com/MatheusCoxxxta/banking-lab/ledger/internal/ledger"
	"github.com/google/uuid"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/wagslane/go-rabbitmq"
)

type SendMoneyDto struct {
	IdempotencyKey string    `json:"idempotency_key" validate:"required,uuid4"`
	SenderId       uuid.UUID `json:"sender_id" validate:"required,uuid4"`
	Amount         int64     `json:"amount" validate:"required"`
	ReceiverId     uuid.UUID `json:"receiver_id" validate:"required,uuid4"`
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)

	json.NewEncoder(w).Encode(map[string]string{
		"status": "ok",
		"time":   time.Now().Format(time.RFC3339),
	})
}

func main() {
	envs, err := config.LoadAndValidateEnv()

	if err != nil {
		log.Fatal(err)
	}

	pool, err := pgxpool.New(context.Background(), envs.DatabaseURL)
	if err != nil {
		log.Fatal(err)
	}

	log.Println("Starting server on :" + envs.Port)
	if err != nil {
		log.Fatal(err)
	}

	r := chi.NewRouter()

	conn, err := rabbitmq.NewConn(
		envs.RabbitMqUrl,
		rabbitmq.WithConnectionOptionsLogging,
	)

	if err != nil {
		log.Fatal(err)
	}

	defer conn.Close()

	publisher, err := rabbitmq.NewPublisher(
		conn,
		rabbitmq.WithPublisherOptionsLogging,
		rabbitmq.WithPublisherOptionsExchangeName("ledger.balance"),
		rabbitmq.WithPublisherOptionsExchangeDeclare,
		rabbitmq.WithPublisherOptionsExchangeKind("topic"),
		rabbitmq.WithPublisherOptionsExchangeDurable,
	)

	if err != nil {
		log.Fatal(err)
	}

	defer publisher.Close()

	q := ledger.New(pool)
	s := ledger.NewStore(pool, q, publisher)

	r.Get("/health", handleHealth)
	r.Get("/ledger/health", handleHealth)
	r.Post("/ledger/transfer", ledger.ErrorWrapper(s.HandleTransferMoney))

	go func() {
		if err := s.OutboxObserver(context.Background()); err != nil {
			log.Println("Starting server on :" + envs.Port)
		}
	}()

	log.Fatal(http.ListenAndServe(":"+envs.Port, r))
}
