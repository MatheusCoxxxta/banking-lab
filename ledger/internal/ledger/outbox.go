package ledger

import (
	"context"
	"log"
	"time"

	"github.com/wagslane/go-rabbitmq"
)

func (s *Store) OutboxObserver(ctx context.Context) error {
	ticker := time.NewTicker(time.Millisecond * 100)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			pE, err := s.Queries.findOutboxByStatus(ctx, "pending")

			if err != nil {
				log.Printf("Error processing outbox query: %s", err.Error())
				continue
			}

			for _, event := range pE {
				incrementOutboxAttemptErr := s.Queries.incrementOutboxAttempt(ctx, event.ID)

				if err != nil {
					log.Printf("Error tyring to incrementOutboxAttemptErr: %s", incrementOutboxAttemptErr.Error())

				}

				publishErr := s.Publisher.Publish(
					event.Payload,
					[]string{"balance.updated"},
					rabbitmq.WithPublishOptionsContentType("application/json"),
					rabbitmq.WithPublishOptionsExchange("ledger.balance"),
				)

				if publishErr != nil {
					log.Printf("Error publishing event %s: %s", event.ID, err)
					continue
				}

				err = s.Queries.updateOutboxStatus(ctx, updateOutboxStatusParams{
					ID:     event.ID,
					Status: "sent",
				})

				if err != nil {
					log.Printf("Error tyring to updateOutboxStatus: %s", err.Error())
					continue
				}
			}
		}
	}
}
