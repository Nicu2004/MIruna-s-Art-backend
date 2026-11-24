class MailServiceInterface {
	async sendMail(message) {
		throw new Error('sendMail must be implemented by a mail service');
	}
}

module.exports = MailServiceInterface;
