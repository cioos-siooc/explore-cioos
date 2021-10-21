import smtplib
from email.message import EmailMessage
import smtplib
import os
import configparser

if os.getenv("GMAIL_USER"):
    envs=os.environ
else:
    config = configparser.ConfigParser()
    config.read(".env")
    envs = config["scheduler"]

def send_email(mail_to, mail_message_body, mail_subject):
    gmail_user = envs['GMAIL_USER']
    if not gmail_user:
        return
    gmail_password = envs['GMAIL_PASSWORD']

    msg = EmailMessage()
    msg['Subject'] = mail_subject
    msg['From'] = gmail_user
    msg['To'] = mail_to
    msg.set_content(mail_message_body)

    s = smtplib.SMTP_SSL('smtp.gmail.com', 465)
    s.login(gmail_user,gmail_password)
    s.send_message(msg)
    s.quit()

    