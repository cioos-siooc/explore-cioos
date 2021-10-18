FROM python:3.9

WORKDIR /usr/src/app

COPY . .

RUN pip install ./scraper

CMD [ "sh","./scraper/run.sh" ]
