-- CreateTable
CREATE TABLE "postcode_geo_cache" (
    "id" TEXT NOT NULL,
    "postcode_normalized" TEXT NOT NULL,
    "postcode_display" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "outcode" TEXT,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "postcode_geo_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "postcode_geo_cache_postcode_normalized_key" ON "postcode_geo_cache"("postcode_normalized");

-- CreateIndex
CREATE INDEX "idx_postcode_geo_cache_outcode" ON "postcode_geo_cache"("outcode");

-- CreateIndex
CREATE INDEX "idx_postcode_geo_cache_updated_at" ON "postcode_geo_cache"("updated_at");
