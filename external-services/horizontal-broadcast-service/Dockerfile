FROM golang:1.21-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o horizontal-broadcast-service .

FROM alpine:latest
RUN apk --no-cache add ca-certificates wget
WORKDIR /root/

COPY --from=builder /app/horizontal-broadcast-service .
COPY config.yaml .

EXPOSE 8085 8086 8087

CMD ["./horizontal-broadcast-service"]