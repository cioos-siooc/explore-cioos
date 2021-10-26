import smtplib
from email.message import EmailMessage
import smtplib
import os
import traceback
from dotenv import load_dotenv

envs=os.environ

if not os.getenv("GMAIL_USER"):
    load_dotenv(os.getcwd() + '/.env')


def send_email(mail_to, mail_message_body, mail_subject):
    if 'GMAIL_USER' not in envs:
        print("GMAIL auth not configured")
        return 

    gmail_user = envs['GMAIL_USER']
    if not gmail_user:
        return
    gmail_password = envs['GMAIL_PASSWORD']

    msg = EmailMessage()
    msg['Subject'] = mail_subject
    msg['From'] = gmail_user
    msg['To'] = mail_to
    msg.set_content(mail_message_body)

    try:
        s = smtplib.SMTP_SSL('smtp.gmail.com', 465)
        s.login(gmail_user,gmail_password)
        s.send_message(msg)
        s.quit()
    except smtplib.SMTPAuthenticationError as e:
        print(e,traceback.format_exc())

