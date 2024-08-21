FROM python:3.10.2

WORKDIR /usr/src/app

COPY ./harvester ./db-loader ./download_scheduler ./pyproject.toml ./poetry.lock ./

RUN pip install -q .

CMD [ "sh","./harvester/run.sh" ]
