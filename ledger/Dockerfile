FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /app .

FROM gcr.io/distroless/static-debian12
COPY --from=build /app /app
ENV PORT=3002
EXPOSE 3002
ENTRYPOINT ["/app"]