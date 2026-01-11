FROM node:22-alpine

RUN apk add --no-cache openssl

WORKDIR /app

COPY package*.json ./

RUN npm install

COPY prisma ./prisma/
COPY prisma.config.ts ./ 

RUN DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy npx prisma generate

COPY . .

RUN npm run build


EXPOSE 3000

CMD ["sh", "-c", "npx prisma db push && npm run start:prod"]