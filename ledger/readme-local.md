Sempre esqueço, então:

- Iniciar projeto

```bash
go mod init github.com/MatheusCoxxxta/ledger-lab-go
```

- Run project

```bash
go run .
```

- Build executable

```bash
go build -o ledger-lab-go .
```

## Coding

Install chi lib for init HTTP server:


```bash
go get github.com/go-chi/chi/v5
```

Use chi to create a simple HTTP server:

```go
import (
    "github.com/go-chi/chi/v5"
    "net/http"
    "log"
    "os"
)

func main() {
    PORT := os.Getenv("PORT")
    if PORT == "" {
        log.Println("PORT NOT SET BUT IT'S REQUIRED")
        return
    }

    r := chi.NewRouter()
    
    log.Println("Starting server on :" + PORT)
    log.Fatal(http.ListenAndServe(":"+PORT, nil))
}
```

Install go-playground/validator validation:

```bash
go get github.com/go-playground/validator/v10
```

Use it:

```go
import (
    "github.com/go-playground/validator/v10"
    "github.com/go-chi/chi/v5"
    "net/http"
    "log"
    "os"
	"github.com/jackc/pgx/v5/pgtype"
)

type SendMoneyDto struct {
	IdempotencyKey string `json:"idempotency_key" validate:"required,min=1,max=36"`
	SenderId       pgtype.UUID `json:"sender_id" validate:"required,min=36,max=36"`
	Amount         int32  `json:"amount" validate:"required"`
	ReceiverId     pgtype.UUID `json:"receiver_id" validate:"required,min=36,max=36"`
}

var validate = validator.New()

func DecodeAndValidate[T any](r *http.Request) (T, error) {
	var v T

	if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
		return v, err
	}

	validationErr := validate.Struct(v)

	return v, validationErr
}
```

Run it 

PORT=3000 DATABASE_URL="postgres://postgres:postgres@localhost:5438/ledgerlab"  go run .

Curl:

```bash
curl -X POST http://localhost:3000/send \
  -H "Content-Type: application/json" \
  -d '{
    "idempotency_key": "0ce51bdf-ed3a-459f-abbb-a8df3f086e4c",
    "sender_id": "a3d1cbd7-1730-429e-b1da-5e00116fb053",
    "amount": 15,
    "receiver_id": "0ce51bdf-ed3a-459f-abbb-a8df3f086e4c"
  }'
```