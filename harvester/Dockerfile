FROM python:3.10.2

WORKDIR /usr/src/app

COPY harvester /usr/src/app/harvester
COPY downloader /usr/src/app/downloader
COPY db-loader /usr/src/app/db-loader
COPY download_scheduler /usr/src/app/download_scheduler
COPY pyproject.toml /usr/src/app/pyproject.toml
COPY poetry.lock /usr/src/app/poetry.lock
COPY README.md /usr/src/app/README.md

RUN pip install --upgrade pip
RUN pip install poetry
RUN poetry config virtualenvs.create false
RUN poetry install

CMD [ "sh","./harvester/run.sh" ]
