'use strict';

var uri = process.env.DBURI || '127.0.0.1:27017/development';
var db = exports.db = require('monk')(uri);
var registerRepo = require('./gitListener/gitHooks.js').registerRepo;

/*
  Repos collection document structure:  
  {"repo_id": 11667865,
  "repo_info": {
    "git_url": "git://github.com/reactjs/react-rails.git",
    "name" : "react-rails",
    "scan_results" : "",
    "retire_results" : "",
    "parse_results" : "",
    "users" : [], 
    }
  }
*/

// Assume immutable types are stored in the arrays
exports.compareArrays = function (leftArray, rightArray) {
  var intersect = [];

  var leftUniq = leftArray.filter(function(item){
    if (rightArray.indexOf(item) !== -1) {
      intersect.push(item);
      return false;
    } else {
      return true;
    }
  });

  var rightUniq = rightArray.filter(function(item){
    return leftArray.indexOf(item) === -1;
  });

  return {
    rightUniq: rightUniq,
    leftUniq: leftUniq,
    intersect: intersect
  };
};

var getAuthToken = function(userid, callback) {
  db.get('users').findOne({userid: userid}, function(err, doc){
    if (err) {
      console.error(err);
    } else {
      callback(doc.accessToken);
    }
  });
};

var insertRepo = function(params, callback) {
  var repo = {
    'repo_id': params.repoid,
    'repo_info': {
      'git_url': params.git_url,
      'name': params.name,
      'scan_results': {},
      'retire_results': {},
      'parse_results': {},
      'users': [params.userid], 
    }
  };

  db.get('Repos').insert(repo, function(err, doc) {
    if (err) {
      console.error(err);
    } else {
      callback(doc);
    }
  });
};

exports.findAllReposByUser = function(userID, callback) {
  db.get('Repos').find({'repo_info.users': userID})
    .on('complete', function(err, docs) {
      if (err) {
        console.error('find all repos by user failed with error!: ', err);
      } else {
        if (callback) {
          callback(docs);
        }
      }
    });
};

exports.userInRepo = function(userID, repoID, callback) {
  // check if user exists for repo
  db.get('Repos').findOne({'repo_id': repoID, 'repo_info.users': userID})
    .on('complete', function(err, doc) {
      if (err) {
        console.error('add user to repo failed with error!: ', err);
      } else {
        // if there isn't a record with that repoID and the specified userID add it
        if (!doc) {
          // add user to that document
          db.get('Repos').update({'repo_id': repoID}, {$push: {'repo_info.users': userID}})
            .on('complete', function(err, doc) {
              console.log('item found and updated: ', doc);
              if (callback) {
                callback(doc);
              }
            });
        }
      }

    });
};

// get or add repo
// Params {
//  userid: userid,
//  repoid: repoid,
//  name: name,
//  html_url: html_url,
//  git_url, git_url,
// }
exports.getOrInsertRepo = function(params, callback) {
  var repos = db.get('Repos');
  repos.findOne({repo_id: params.repoid}, function(err, doc){
    if (err) {
      console.error(err);
    } else {
      if (doc) {
        exports.userInRepo(params.userid, params.repoid, callback);
      } else {
        
        getAuthToken(params.userid, function(token){
          if (token) {
            console.log('About to call register repo', params.html_url, token);
            registerRepo(params.html_url, token);
          }
        });
              
        insertRepo(params, function() { //ignoring doc
          exports.userInRepo(params.userid, params.repoid, callback);
        });
      }
    }
  });
};

exports.removeRepo = function(userId, repoId, html_url) {
  var repos = db.get('Repos');
  getAuthToken(userId, function(token) {
    registerRepo(html_url, token, true);
  });

  repos.remove({'repo_id': repoId}, function(error){
    if (error) {
      console.error(error);
    }
  });
};

// look for a repo and remove the given user if they exist,
exports.removeUserFromRepo = function(userID, repoID, html_url) {
  var repos = db.get('Repos');
  // remove the user from the users array
  repos.update({repo_id: repoID}, {$pull: {'repo_info.users': userID}}, function(err) { // doc is 2nd arg to callback
    if (err) {
      console.error(err);
    } else {
      // get the doc we just updated
      repos.findOne({repo_id: repoID}, function(err, doc) {
        // if the doc has no users, remove it
        if (doc.repo_info.users.length === 0) {
          // call fn to remove the repo and hooks
          exports.removeRepo(userID, repoID, html_url); // callback?
        } else { // otherwise we're done
          console.log('user removed from repo and repo still exists'); // callback?
        }
      });
    }
  });
};
