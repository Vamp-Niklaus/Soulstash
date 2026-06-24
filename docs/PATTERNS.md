# Design Patterns in Soulstash

The Soulstash microservices heavily leverage the **Gang of Four (GoF) Design Patterns** and **SOLID Principles** to ensure the code is decoupled, scalable, and easy to test.

## Creational Patterns
- **Factory Method:** Used in `ScraperFactory` to instantiate the correct video scraping strategy (e.g., `FetchStrategy` vs `PlaywrightStrategy`) based on the requested source at runtime.
- **Singleton:** Used for `Logger` and `ConfigManager` in the `shared` library to ensure only one stateful instance is utilized across an entire microservice lifecycle.

## Structural Patterns
- **Adapter:** The `TMDBAdapter` wraps the external TMDB API, ensuring our core application only depends on our internal `IMetadataProvider` interface. This protects the app from external API changes.
- **Decorator:** The `CachingDecorator` dynamically wraps the `TMDBAdapter`. It intercepts method calls to check the cache before ever making a network request, adhering to the Single Responsibility Principle.
- **Facade:** The `GatewayFacade` in the API Gateway hides the complexity of setting up routes, registering middleware chains, and proxying requests.
- **Proxy:** The `ScraperProxy` defers the heavy, memory-intensive execution of Playwright by intercepting calls and returning cached streaming links if they exist.

## Behavioral Patterns
- **Chain of Responsibility:** Express middleware in the API Gateway is strictly modeled as a chain (`RateLimitMiddleware -> AuthMiddleware -> Proxy`). Requests flow through these handlers linearly.
- **Strategy:** The `IScrapingStrategy` interface is implemented by different concrete algorithms (`FetchStrategy` and `PlaywrightStrategy`). The application swaps these out seamlessly depending on the website being scraped.
- **Command:** Inside the Collection Service, actions like creating a playlist are encapsulated as Command objects (`CreateCollectionCommand`). This allows us to queue, log, and even undo operations dynamically.
