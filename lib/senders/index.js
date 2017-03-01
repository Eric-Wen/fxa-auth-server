/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This indirection exists to accommodate different config properties
// in the old auth mailer. If/when the two config files are merged and
// there's nothing left that imports mailer/config, it is safe to merge
// legacy_index.js and this file into one. Be careful not to mix the args
// up when you do that, they expect config and log in a different order.
var createSenders = require('./legacy_index')

module.exports = function (config, log, error, db) {
  var defaultLanguage = config.i18n.defaultLanguage

  return createSenders(
    log,
    {
      locales: config.i18n.supportedLanguages,
      defaultLanguage: defaultLanguage,
      mail: config.smtp,
      sms: config.sms
    }
  )
  .then(function (senders) {
    var ungatedMailer = senders.email
    var configBounces = config.bounces || {}
    var MAX_HARD = configBounces.hard && configBounces.hard.max || 0
    var MAX_SOFT = configBounces.soft && configBounces.soft.max || 0
    var MAX_COMPLAINT = configBounces.complaint && configBounces.complaint.max || 0
    var DURATION_HARD = configBounces.hard && configBounces.hard.duration || Infinity
    var DURATION_SOFT = configBounces.soft && configBounces.soft.duration || Infinity
    var DURATION_COMPLAINT = configBounces.complaint && configBounces.complaint.duration || Infinity
    var BOUNCE_TYPE_HARD = 1
    var BOUNCE_TYPE_SOFT = 2
    var BOUNCE_TYPE_COMPLAINT = 3

    function checkBounce(bounce, rules, now) {
      for (var i = 0; i < rules.length; i++) {
        var ruleSet = rules[i]

        if (bounce.bounceType === ruleSet.type) {
          if (bounce.createdAt > now - ruleSet.duration) {
            ruleSet.count++
            if (ruleSet.count > ruleSet.max) {
              throw ruleSet.error()
            }
          }
          break
        }
      }
    }

    var bounceRules = [
      {
        count: 0,
        duration: DURATION_HARD,
        error: error.emailBouncedHard,
        max: MAX_HARD,
        type: BOUNCE_TYPE_HARD
      },
      {
        count: 0,
        duration: DURATION_COMPLAINT,
        error: error.emailComplaint,
        max: MAX_COMPLAINT,
        type: BOUNCE_TYPE_COMPLAINT
      },
      {
        count: 0,
        duration: DURATION_SOFT,
        error: error.emailBouncedSoft,
        max: MAX_SOFT,
        type: BOUNCE_TYPE_SOFT
      }
    ]

    function bounceGatedMailer(email) {
      return db.emailBounces(email)
        .then(function (bounces) {
          bounceRules[0].count = bounceRules[1].count = bounceRules[2].count= 0
          var now = Date.now()
          bounces.forEach(function (bounce) {
            checkBounce(bounce, bounceRules, now)
          })
          return ungatedMailer
        })
        .catch(function (err) {
          log.info({
            op: 'mailer.blocked',
            errno: err.errno
          })
          throw err
        })
    }

    senders.email = {
      sendVerifyCode: function (account, code, opts) {
        return bounceGatedMailer(account.email)
          .then(function (mailer) {
            return mailer.verifyEmail({
              email: account.email,
              flowId: opts.flowId,
              flowBeginTime: opts.flowBeginTime,
              uid: account.uid.toString('hex'),
              code: code.toString('hex'),
              service: opts.service,
              redirectTo: opts.redirectTo,
              resume: opts.resume,
              acceptLanguage: opts.acceptLanguage || defaultLanguage,
              ip: opts.ip,
              location: opts.location,
              uaBrowser: opts.uaBrowser,
              uaBrowserVersion: opts.uaBrowserVersion,
              uaOS: opts.uaOS,
              uaOSVersion: opts.uaOSVersion
            })
          })
      },
      sendVerifyLoginEmail: function (account, code, opts) {
        return bounceGatedMailer(account.email)
          .then(function (mailer) {
            return mailer.verifyLoginEmail({
              acceptLanguage: opts.acceptLanguage || defaultLanguage,
              code: code.toString('hex'),
              email: account.email,
              ip: opts.ip,
              flowId: opts.flowId,
              flowBeginTime: opts.flowBeginTime,
              location: opts.location,
              redirectTo: opts.redirectTo,
              resume: opts.resume,
              service: opts.service,
              timeZone: opts.timeZone,
              uaBrowser: opts.uaBrowser,
              uaBrowserVersion: opts.uaBrowserVersion,
              uaOS: opts.uaOS,
              uaOSVersion: opts.uaOSVersion,
              uid: account.uid.toString('hex')
            })
          })
      },
      sendRecoveryCode: function (token, code, opts) {
        return bounceGatedMailer(token.email)
          .then(function (mailer) {
            return mailer.recoveryEmail({
              email: token.email,
              flowId: opts.flowId,
              flowBeginTime: opts.flowBeginTime,
              token: token.data.toString('hex'),
              code: code.toString('hex'),
              service: opts.service,
              redirectTo: opts.redirectTo,
              resume: opts.resume,
              acceptLanguage: opts.acceptLanguage || defaultLanguage,
              ip: opts.ip,
              location: opts.location,
              timeZone: opts.timeZone,
              uaBrowser: opts.uaBrowser,
              uaBrowserVersion: opts.uaBrowserVersion,
              uaOS: opts.uaOS,
              uaOSVersion: opts.uaOSVersion
            })
          })
      },
      sendPasswordChangedNotification: function (email, opts) {
        return bounceGatedMailer(email)
          .then(function (mailer) {
            return mailer.passwordChangedEmail({
              email: email,
              acceptLanguage: opts.acceptLanguage || defaultLanguage,
              ip: opts.ip,
              location: opts.location,
              uaBrowser: opts.uaBrowser,
              uaBrowserVersion: opts.uaBrowserVersion,
              uaOS: opts.uaOS,
              uaOSVersion: opts.uaOSVersion
            })
          })
      },
      sendPasswordResetNotification: function (email, opts) {
        return bounceGatedMailer(email)
          .then(function (mailer) {
            return mailer.passwordResetEmail({
              email: email,
              acceptLanguage: opts.acceptLanguage || defaultLanguage,
              flowId: opts.flowId,
              flowBeginTime: opts.flowBeginTime,
            })
          })
      },
      sendNewDeviceLoginNotification: function (email, opts) {
        return bounceGatedMailer(email)
          .then(function (mailer) {
            return mailer.newDeviceLoginEmail({
              acceptLanguage: opts.acceptLanguage || defaultLanguage,
              flowId: opts.flowId,
              flowBeginTime: opts.flowBeginTime,
              email: email,
              ip: opts.ip,
              location: opts.location,
              timeZone: opts.timeZone,
              uaBrowser: opts.uaBrowser,
              uaBrowserVersion: opts.uaBrowserVersion,
              uaOS: opts.uaOS,
              uaOSVersion: opts.uaOSVersion
            })
          })
      },
      sendPostVerifyEmail: function (email, opts) {
        return bounceGatedMailer(email)
          .then(function (mailer) {
            return mailer.postVerifyEmail({
              email: email,
              acceptLanguage: opts.acceptLanguage || defaultLanguage
            })
          })
      },
      sendUnblockCode: function (account, unblockCode, opts) {
        return bounceGatedMailer(account.email)
          .then(function (mailer) {
            return mailer.unblockCodeEmail({
              acceptLanguage: opts.acceptLanguage || defaultLanguage,
              flowId: opts.flowId,
              flowBeginTime: opts.flowBeginTime,
              email: account.email,
              ip: opts.ip,
              location: opts.location,
              timeZone: opts.timeZone,
              uaBrowser: opts.uaBrowser,
              uaBrowserVersion: opts.uaBrowserVersion,
              uaOS: opts.uaOS,
              uaOSVersion: opts.uaOSVersion,
              uid: account.uid.toString('hex'),
              unblockCode: unblockCode
            })
          })
      },
      translator: function () {
        return ungatedMailer.translator.apply(ungatedMailer, arguments)
      },
      stop: function () {
        return ungatedMailer.stop()
      },
      _ungatedMailer: ungatedMailer
    }
    return senders
  })
}
