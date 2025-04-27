## Test Build time setup

1. Move `output` folder outisde Rocket.Chat folder.
2. Run `meteor build --server-only --directory ../output` from root of the repo.
3. Start the mongo server using [mongo compose](./docker/compose.mongo.yml)
4. Start buildtime setup using [buildtime compose](./docker/compose.build.yml)

#### Note - Can also use tar file for offline installation if node_modules is cached