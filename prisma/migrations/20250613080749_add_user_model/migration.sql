-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "userName" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
