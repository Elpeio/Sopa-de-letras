# Servidor completo de la biblioteca (Sopa, Chinchón y Truco con multijugador).
FROM oven/bun:1-slim
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
COPY src ./src
ENV PORT=3000
EXPOSE 3000
CMD ["bun", "src/server.ts"]
