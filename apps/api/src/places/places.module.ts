import { Module } from '@nestjs/common';
import { GooglePlacesClient } from './google-places.client.js';
import { GridSeedService } from './grid-seed.service.js';
import { OsmPlacesClient } from './osm-places.client.js';
import { PlacesController } from './places.controller.js';
import { RetentionService } from './retention.service.js';

@Module({
  controllers: [PlacesController],
  providers: [GooglePlacesClient, OsmPlacesClient, GridSeedService, RetentionService],
  exports: [GooglePlacesClient, OsmPlacesClient, GridSeedService, RetentionService],
})
export class PlacesModule {}
