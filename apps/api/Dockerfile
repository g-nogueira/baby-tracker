FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /source
COPY . .
RUN dotnet restore BabyTracker.slnx \
    && dotnet publish apps/api/src/BabyTracker.Api/BabyTracker.Api.csproj \
        --configuration Release \
        --no-restore \
        --output /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine AS runtime
RUN addgroup -S babytracker && adduser -S babytracker -G babytracker
WORKDIR /app
COPY --from=build --chown=babytracker:babytracker /app .
USER babytracker
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "BabyTracker.Api.dll"]
