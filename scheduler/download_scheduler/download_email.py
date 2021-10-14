import smtplib
import os

def send_email(mail_to, mail_message_body, mail_subject):
    
    # gmail_user = os.env('GMAIL_USER')
    # if not gmail_user:
    #     return
    # gmail_password = os.env('GMAIL_PASSWORD')# Create Email 
    # mail_from = gmail_user

    # mail_message = f'''\
    # From: {mail_from}
    # To: {mail_to}
    # Subject: {mail_subject}
    # {mail_message_body}
    # '''
    # server = smtplib.SMTP_SSL('smtp.gmail.com', 465)
    # server.login(gmail_user, gmail_password)
    # server.sendmail(mail_from, mail_to, mail_message)
    # server.close()
    