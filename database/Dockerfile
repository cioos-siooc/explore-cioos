FROM postgis/postgis:18-3.6-alpine AS h3
ARG H3_PG_VERSION=v4.2.3
RUN apk add --no-cache build-base cmake git
RUN git clone --depth 1 --branch ${H3_PG_VERSION} https://github.com/postgis/h3-pg /h3-pg \
 && cmake -S /h3-pg -B /h3-pg/build -DCMAKE_BUILD_TYPE=Release \
 && cmake --build /h3-pg/build \
 && DESTDIR=/out cmake --install /h3-pg/build --component h3-pg

FROM postgis/postgis:18-3.6-alpine
COPY --from=h3 /out/ /
COPY *.sql /docker-entrypoint-initdb.d/
