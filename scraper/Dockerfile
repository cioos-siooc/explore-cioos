FROM python:3.9

WORKDIR /usr/src/app

COPY . .

RUN pip install -q ./scraper

CMD [ "sh","./scraper/run.sh" ]
