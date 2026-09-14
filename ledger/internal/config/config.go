package config

import (
	"fmt"
	"os"
)

type Config struct {
	DatabaseURL string
	Port        string
	RabbitMqUrl string
}

func LoadAndValidateEnv() (*Config, error) {
	envs := Config{
		DatabaseURL: os.Getenv("DATABASE_URL"),
		Port:        os.Getenv("PORT"),
		RabbitMqUrl: os.Getenv("RABBITMQ_URL"),
	}

	if envs.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL not set")
	}

	if envs.Port == "" {
		return nil, fmt.Errorf("PORT not set")
	}

	if envs.RabbitMqUrl == "" {
		return nil, fmt.Errorf("RABBITMQ_URL not set")
	}

	return &envs, nil
}
