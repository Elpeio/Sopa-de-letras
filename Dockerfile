FROM oven/bun:1
WORKDIR /app
COPY . .
EXPOSE 3000
CMD ["bun", "src/server.ts"]
