function changePKtoPkURL(e) {
  return { ...e, pk: e.pk_url };
}
module.exports = { changePKtoPkURL };
